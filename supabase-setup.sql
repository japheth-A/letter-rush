create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-F0-9]{8}$'),
  host_player_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  round_number integer not null default 0 check (round_number >= 0),
  letter text check (letter is null or letter ~ '^[A-W]$'),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.room_players (
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  player_name text not null check (char_length(player_name) between 1 and 24),
  is_host boolean not null default false,
  total_score integer not null default 0 check (total_score >= 0),
  round_score integer not null default 0 check (round_score between 0 and 50),
  submitted_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (room_id, player_id)
);

create index if not exists room_players_room_joined_idx
  on public.room_players (room_id, joined_at);

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
revoke all on table public.rooms, public.room_players from anon, authenticated;
grant select on table public.rooms, public.room_players to authenticated;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and player_id = (select auth.uid())
  );
$function$;

revoke all on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;

drop policy if exists "Room members can read rooms" on public.rooms;
create policy "Room members can read rooms"
  on public.rooms for select to authenticated
  using (public.is_room_member(id));

drop policy if exists "Room members can read players" on public.room_players;
create policy "Room members can read players"
  on public.room_players for select to authenticated
  using (public.is_room_member(room_id));

create or replace function public.create_room(p_player_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player_id uuid := auth.uid();
  v_room_id uuid := gen_random_uuid();
  v_room_code text;
  v_player_name text := trim(p_player_name);
begin
  if v_player_id is null then
    raise exception 'Sign in before creating a room.';
  end if;
  if v_player_name is null or char_length(v_player_name) not between 1 and 24 then
    raise exception 'Your name must be between 1 and 24 characters.';
  end if;

  loop
    v_room_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into public.rooms (id, code, host_player_id)
    values (v_room_id, v_room_code, v_player_id)
    on conflict (code) do nothing;
    exit when found;
  end loop;

  insert into public.room_players (room_id, player_id, player_name, is_host)
  values (v_room_id, v_player_id, v_player_name, true);

  return jsonb_build_object(
    'room_id', v_room_id,
    'room_code', v_room_code,
    'player_id', v_player_id
  );
end;
$function$;

create or replace function public.join_room(p_room_code text, p_player_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player_id uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_player_name text := trim(p_player_name);
begin
  if v_player_id is null then
    raise exception 'Sign in before joining a room.';
  end if;
  if v_player_name is null or char_length(v_player_name) not between 1 and 24 then
    raise exception 'Your name must be between 1 and 24 characters.';
  end if;

  select * into v_room
  from public.rooms
  where code = upper(trim(p_room_code))
  for update;
  if not found then
    raise exception 'That room code was not found.';
  end if;

  if exists (
    select 1 from public.room_players
    where room_id = v_room.id and player_id = v_player_id
  ) then
    update public.room_players
    set player_name = v_player_name
    where room_id = v_room.id and player_id = v_player_id;
  else
    if v_room.status <> 'waiting' then
      raise exception 'This game has already started.';
    end if;
    if (select count(*) from public.room_players where room_id = v_room.id) >= 8 then
      raise exception 'This room is full (8 players maximum).';
    end if;
    insert into public.room_players (room_id, player_id, player_name)
    values (v_room.id, v_player_id, v_player_name);
  end if;

  return jsonb_build_object(
    'room_id', v_room.id,
    'room_code', v_room.code,
    'player_id', v_player_id
  );
end;
$function$;

create or replace function public.start_room_round(p_room_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player_id uuid := auth.uid();
  v_room public.rooms%rowtype;
begin
  select * into v_room
  from public.rooms
  where code = upper(trim(p_room_code))
  for update;
  if not found or v_room.host_player_id <> v_player_id then
    raise exception 'Only the room host can start a round.';
  end if;
  if v_room.status not in ('waiting', 'finished') then
    raise exception 'A round is already in progress.';
  end if;
  if (select count(*) from public.room_players where room_id = v_room.id) < 2 then
    raise exception 'Invite at least one friend before starting.';
  end if;

  update public.room_players
  set round_score = 0, submitted_at = null
  where room_id = v_room.id;
  update public.rooms
  set status = 'playing',
      round_number = round_number + 1,
      letter = substr('ABCDEFGHIJKLMNOPRSTUVW', floor(random() * 22)::integer + 1, 1),
      started_at = now(),
      finished_at = null
  where id = v_room.id;
end;
$function$;

create or replace function public.finish_room_if_due(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_room public.rooms%rowtype;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found
     or v_room.status <> 'playing'
     or now() < v_room.started_at + interval '60 seconds' then
    return false;
  end if;

  update public.room_players
  set round_score = 0,
      submitted_at = v_room.started_at + interval '60 seconds'
  where room_id = v_room.id and submitted_at is null;
  update public.rooms
  set status = 'finished', finished_at = now()
  where id = v_room.id;
  return true;
end;
$function$;

create or replace function public.submit_room_answers(p_room_code text, p_answers jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player_id uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_answer text;
  v_score integer := 0;
  v_index integer;
begin
  select * into v_room
  from public.rooms
  where code = upper(trim(p_room_code))
  for update;
  if not found or v_room.status <> 'playing' then
    raise exception 'This round is not accepting answers.';
  end if;
  if not exists (
    select 1 from public.room_players
    where room_id = v_room.id and player_id = v_player_id
  ) then
    raise exception 'You are not a player in this room.';
  end if;
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> 5 then
    raise exception 'Please submit one answer for each category.';
  end if;

  if public.finish_room_if_due(v_room.id) then
    return 0;
  end if;

  if exists (
    select 1 from public.room_players
    where room_id = v_room.id
      and player_id = v_player_id
      and submitted_at is not null
  ) then
    select round_score into v_score from public.room_players
    where room_id = v_room.id and player_id = v_player_id;
    return v_score;
  end if;

  for v_index in 0..4 loop
    if jsonb_typeof(p_answers -> v_index) <> 'string' then
      raise exception 'Answers must be text.';
    end if;
    v_answer := trim(p_answers ->> v_index);
    if char_length(v_answer) > 60 then
      raise exception 'Answers must be 60 characters or fewer.';
    end if;
    if v_answer <> '' and upper(left(v_answer, 1)) = v_room.letter then
      v_score := v_score + 10;
    end if;
  end loop;

  update public.room_players
  set round_score = v_score,
      total_score = total_score + v_score,
      submitted_at = now()
  where room_id = v_room.id and player_id = v_player_id;

  if not exists (
    select 1 from public.room_players
    where room_id = v_room.id and submitted_at is null
  ) then
    update public.rooms
    set status = 'finished', finished_at = now()
    where id = v_room.id;
  end if;
  return v_score;
end;
$function$;

create or replace function public.finish_room_on_timeout(p_room_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_room_id uuid;
begin
  select id into v_room_id
  from public.rooms
  where code = upper(trim(p_room_code))
    and public.is_room_member(id);
  if not found then
    raise exception 'That room was not found.';
  end if;
  return public.finish_room_if_due(v_room_id);
end;
$function$;

create or replace function public.leave_room(p_room_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player_id uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_next_host uuid;
begin
  select * into v_room
  from public.rooms
  where code = upper(trim(p_room_code))
  for update;
  if not found then
    return;
  end if;
  if not exists (
    select 1 from public.room_players
    where room_id = v_room.id and player_id = v_player_id
  ) then
    return;
  end if;
  if v_room.status = 'playing' then
    raise exception 'Finish the current round before leaving the room.';
  end if;

  delete from public.room_players
  where room_id = v_room.id and player_id = v_player_id;

  if v_room.host_player_id = v_player_id then
    select player_id into v_next_host
    from public.room_players
    where room_id = v_room.id
    order by joined_at
    limit 1;

    if v_next_host is null then
      delete from public.rooms where id = v_room.id;
    else
      update public.rooms set host_player_id = v_next_host where id = v_room.id;
      update public.room_players
      set is_host = (player_id = v_next_host)
      where room_id = v_room.id;
    end if;
  end if;
end;
$function$;

revoke all on function public.create_room(text) from public, anon;
revoke all on function public.join_room(text, text) from public, anon;
revoke all on function public.start_room_round(text) from public, anon;
revoke all on function public.finish_room_if_due(uuid) from public, anon, authenticated;
revoke all on function public.submit_room_answers(text, jsonb) from public, anon;
revoke all on function public.finish_room_on_timeout(text) from public, anon;
revoke all on function public.leave_room(text) from public, anon;
grant execute on function public.create_room(text) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.start_room_round(text) to authenticated;
grant execute on function public.submit_room_answers(text, jsonb) to authenticated;
grant execute on function public.finish_room_on_timeout(text) to authenticated;
grant execute on function public.leave_room(text) to authenticated;

do $publication$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_players'
  ) then
    alter publication supabase_realtime add table public.room_players;
  end if;
end;
$publication$;

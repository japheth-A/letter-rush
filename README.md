# Letter Rush: play online with friends

Letter Rush still works as a solo game. To enable private online rooms and shared scores, connect it to a free Supabase project once:

1. Create a project at [supabase.com](https://supabase.com/).
2. In the Supabase dashboard, open **SQL Editor**, paste in [`supabase-setup.sql`](./supabase-setup.sql), and run it. This creates the room tables, access policies, game actions, and live-update subscriptions.
3. In **Authentication** settings, enable the **Anonymous** sign-in provider. Players use anonymous sessions; they do not need accounts.
4. In **Project Settings → API**, copy the **Project URL** and the **publishable key** (or legacy **anon** key). Put them in [`supabase-config.js`](./supabase-config.js), replacing the two `YOUR_...` values.
5. Serve the folder from a web server rather than opening `index.html` directly. For example, use the **Live Server** extension in VS Code, or deploy the files to a static web host. Friends need to open the deployed address to use your rooms.

   GitHub Pages deployment (permanent public URL):
   - Create a GitHub repository and push this project to the `main` branch.
   - In the repository, open **Settings → Pages**.
   - Set **Source** to **Deploy from a branch** and choose the `main` branch with the `/ (root)` folder.
   - Save. GitHub Pages publishes the site at `https://<your-user>.github.io/<repo-name>/`.
   - If you use a custom domain, add a `CNAME` file and configure the DNS records.

6. Choose **Play with friends**, enter a display name, create a room, and share its invite link. Your friends open the link, choose their display names, and join with the displayed room code. Names are saved in each player's browser for next time and can be changed when they create or join a room. The host starts the round once at least one friend has joined.

Each room supports up to eight players. The letter, timer, player readiness, and scores are shared live. Before scoring, the browser checks dictionary-based categories against the free [Dictionary API](https://dictionaryapi.dev/); names, places, and movie/book titles are checked by first letter only. The dictionary check confirms spelling, not whether an answer fits its category. Checked answer words are sent to that dictionary service, while answer text is not stored in the database. Dictionary checks need an internet connection. A player who has not submitted when the timer expires receives zero for that round. A room can play another round after the current round finishes.

**Keep the key public:** the Supabase publishable/anon key belongs in the browser. Never put a `service_role` or secret API key in this project. Row-level security in the SQL setup limits room data to its members.

The Supabase JavaScript client is loaded from jsDelivr, so online play also needs an internet connection.

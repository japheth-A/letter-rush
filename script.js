const CATEGORIES = [
  { name: "A person's name", icon: "☺", placeholder: "e.g. Sam", dictionaryCheck: false },
  { name: "An animal", icon: "♧", placeholder: "e.g. Sloth", dictionaryCheck: true },
  { name: "Something to eat", icon: "✿", placeholder: "e.g. Sushi", dictionaryCheck: true },
  { name: "A place", icon: "⌖", placeholder: "e.g. Seoul", dictionaryCheck: false },
  { name: "Something you can find at home", icon: "⌂", placeholder: "e.g. Sofa", dictionaryCheck: true },
];
const DEFAULT_CATEGORY_COUNT = CATEGORIES.length;
const CATEGORY_OPTIONS = [
  { name: "A color", icon: "◉", placeholder: "e.g. Scarlet", dictionaryCheck: true },
  { name: "A job", icon: "✎", placeholder: "e.g. Sculptor", dictionaryCheck: true },
  { name: "A movie or book", icon: "▤", placeholder: "e.g. Shrek", dictionaryCheck: false },
  { name: "Something in nature", icon: "❋", placeholder: "e.g. Sunflower", dictionaryCheck: true },
  { name: "A mode of transport", icon: "➜", placeholder: "e.g. Scooter", dictionaryCheck: true },
  { name: "Something at school", icon: "⌑", placeholder: "e.g. Science", dictionaryCheck: true },
];
const ROOM_CATEGORY_CATALOG = [...CATEGORIES, ...CATEGORY_OPTIONS];
const ROUND_LENGTH = 60;
const POINTS_PER_ANSWER = 10;
const LETTERS = "ABCDEFGHIJKLMNOPRSTUVW".split("");
const BEST_SCORE_KEY = "letter-rush-best-score";
const ROOM_STORAGE_KEY = "letter-rush-room-code";
const DISPLAY_NAME_KEY = "letter-rush-display-name";
const ROOM_PLAYER_LIMIT = 8;

const form = document.querySelector("#answer-form");
const categoriesGrid = document.querySelector("#categories-grid");
const addCategoryControls = document.querySelector("#add-category-controls");
const addCategoryButton = document.querySelector("#add-category-button");
const categoryOptions = document.querySelector("#category-options");
const letterDisplay = document.querySelector("#letter-display");
const letterValue = document.querySelector("#letter-value");
const timer = document.querySelector("#timer");
const timerValue = document.querySelector("#timer-value");
const timerProgress = document.querySelector("#timer-progress");
const roundStatus = document.querySelector("#round-status");
const roundIndicator = document.querySelector("#round-indicator");
const submitButton = document.querySelector("#submit-button");
const submitLabel = document.querySelector("#submit-label");
const gameMessage = document.querySelector("#game-message");
const resultOverlay = document.querySelector("#result-overlay");
const resultAnswers = document.querySelector("#result-answers");
const bestScoreElement = document.querySelector("#best-score");
const roomOverlay = document.querySelector("#room-overlay");
const roomPanel = document.querySelector("#room-panel");
const roomDialogMessage = document.querySelector("#room-dialog-message");
const roomInstruction = document.querySelector("#room-instruction");
const playerList = document.querySelector("#player-list");
const playerNameInput = document.querySelector("#player-name");
const roomCodeInput = document.querySelector("#room-code-input");
const createRoomButton = document.querySelector("#create-room-button");
const joinRoomButton = document.querySelector("#join-room-button");

let roundNumber = 1;
let currentLetter = "";
let remainingSeconds = ROUND_LENGTH;
let roundTimer = null;
let roundActive = false;
let roundAwaitingValidation = false;
let countdownInProgress = false;
const dictionaryCache = new Map();
let supabaseClient = null;
let activeRoom = null;
let categoryUpdatePending = false;
let roomChannel = null;
let roomRefreshTimeout = null;
let activeClockKey = "";
let timeoutRequestPending = false;
let resultShownRound = "";

function createCategoryFields(selectedCategories = new Set(CATEGORIES.map((category) => category.name))) {
  categoriesGrid.innerHTML = CATEGORIES.map((category, index) => `
    <div class="category-card" data-category-index="${index}">
      <div class="category-label">
        <label class="category-choice" for="category-toggle-${index}">
          <input id="category-toggle-${index}" class="category-toggle" type="checkbox" ${selectedCategories.has(category.name) ? "checked" : ""} aria-label="Include ${category.name}">
          <span><span class="category-icon" aria-hidden="true">${category.icon}</span>${category.name}</span>
        </label>
        ${activeRoom || index >= DEFAULT_CATEGORY_COUNT
          ? `<button class="remove-category-button" type="button" aria-label="Remove ${category.name} category" title="Remove category">×</button>`
          : `<span class="category-number">${String(index + 1).padStart(2, "0")}</span>`}
      </div>
      <input id="answer-${index}" name="answer-${index}" type="text" placeholder="${category.placeholder}" autocomplete="off" maxlength="60" disabled>
    </div>
  `).join("");
}

function renderCategoryOptions() {
  const options = activeRoom ? ROOM_CATEGORY_CATALOG : CATEGORY_OPTIONS;
  const availableOptions = options.filter(
    (option) => !CATEGORIES.some((category) => category.name === option.name),
  );
  categoryOptions.innerHTML = availableOptions.map((option) => `
    <button class="category-option" type="button" data-category-name="${option.name}">
      <span class="category-icon" aria-hidden="true">${option.icon}</span>${option.name}
      <span aria-hidden="true">+</span>
    </button>
  `).join("");
  addCategoryControls.hidden = availableOptions.length === 0;
}

function addCategory(categoryName) {
  const options = activeRoom ? ROOM_CATEGORY_CATALOG : CATEGORY_OPTIONS;
  const category = options.find((option) => option.name === categoryName);
  if (!category || CATEGORIES.some((existing) => existing.name === category.name)) return;
  if (activeRoom) {
    updateRoomCategories([...CATEGORIES.map((existing) => existing.name), category.name]);
    return;
  }
  if (roundActive || countdownInProgress) return;

  CATEGORIES.push(category);
  const selectedCategories = new Set(selectedCategoryNames());
  selectedCategories.add(category.name);
  createCategoryFields(selectedCategories);
  syncCategoryControls(true, false);
  renderCategoryOptions();
  categoryOptions.hidden = true;
  addCategoryButton.setAttribute("aria-expanded", "false");
  gameMessage.textContent = `${category.name} added. Choose your categories, then start when you're ready.`;
}

function selectedCategoryNames() {
  return [...categoriesGrid.querySelectorAll(".category-card")]
    .filter((card) => card.querySelector(".category-toggle").checked)
    .map((card) => CATEGORIES[Number(card.dataset.categoryIndex)].name);
}

function removeCategory(categoryIndex) {
  const category = CATEGORIES[categoryIndex];
  if (!category) return;

  if (activeRoom) {
    if (!canEditRoomCategories()) return;
    updateRoomCategories(CATEGORIES.filter((_, index) => index !== categoryIndex).map((existing) => existing.name));
    return;
  }
  if (categoryIndex < DEFAULT_CATEGORY_COUNT || roundActive || countdownInProgress) return;

  const selectedCategories = new Set(selectedCategoryNames());
  selectedCategories.delete(category.name);
  CATEGORIES.splice(categoryIndex, 1);
  createCategoryFields(selectedCategories);
  syncCategoryControls(true, false);
  renderCategoryOptions();
  gameMessage.textContent = `${category.name} removed.`;
}

function syncCategoryControls(answersDisabled, pickerDisabled) {
  const canEditRoom = canEditRoomCategories();
  const roomIsPlaying = Boolean(activeRoom) && activeRoom.row?.status === "playing";
  const selectionLocked = countdownInProgress || roundActive;
  const answersLocked = Boolean(activeRoom) && !roomIsPlaying;
  categoriesGrid.querySelectorAll(".category-card").forEach((card) => {
    const toggle = card.querySelector(".category-toggle");
    const answer = card.querySelector('input[name^="answer-"]');
    const available = Boolean(activeRoom) || toggle.checked;
    const removeButton = card.querySelector(".remove-category-button");
    card.hidden = false;
    card.classList.toggle("is-excluded", !available);
    toggle.disabled = Boolean(activeRoom) || pickerDisabled || selectionLocked;
    answer.disabled = answersDisabled || !available || answersLocked;
    if (removeButton) removeButton.disabled = activeRoom
      ? !canEditRoom || CATEGORIES.length <= 1
      : false;
  });
  addCategoryButton.disabled = activeRoom ? !canEditRoom : pickerDisabled || selectionLocked;
  addCategoryControls.hidden = categoryOptions.childElementCount === 0 || Boolean(activeRoom && !canEditRoom);
  if (activeRoom && !canEditRoom) {
    categoryOptions.hidden = true;
    addCategoryButton.setAttribute("aria-expanded", "false");
  }
}

function canEditRoomCategories() {
  return Boolean(activeRoom)
    && activeRoom.row?.host_player_id === activeRoom.playerId
    && activeRoom.row.status !== "playing"
    && !categoryUpdatePending;
}

function syncRoomCategories(categoryNames) {
  const names = Array.isArray(categoryNames) && categoryNames.length
    ? categoryNames
    : ROOM_CATEGORY_CATALOG.slice(0, DEFAULT_CATEGORY_COUNT).map((category) => category.name);
  const categories = names.map((name) => ROOM_CATEGORY_CATALOG.find((category) => category.name === name));
  if (categories.some((category) => !category)) {
    throw new Error("This room has an unknown category. Update the Supabase setup and reload.");
  }
  if (categories.map((category) => category.name).join("\0") === CATEGORIES.map((category) => category.name).join("\0")) return;

  CATEGORIES.splice(0, CATEGORIES.length, ...categories);
  createCategoryFields(new Set(names));
  renderCategoryOptions();
}

async function updateRoomCategories(categoryNames) {
  if (!activeRoom || !canEditRoomCategories()) return;
  categoryUpdatePending = true;
  submitButton.disabled = true;
  submitLabel.textContent = "Updating categories…";
  syncCategoryControls(true, true);
  categoryOptions.hidden = true;
  gameMessage.textContent = "Updating room categories…";
  try {
    const { error } = await supabaseClient.rpc("update_room_categories", {
      p_room_code: activeRoom.code,
      p_categories: categoryNames,
    });
    if (error) throw error;
    await refreshRoom();
    gameMessage.textContent = "Room categories updated for everyone.";
  } catch (error) {
    console.error("Could not update the room categories.", error);
    gameMessage.textContent = error.message || "Could not update room categories. Try again.";
  } finally {
    categoryUpdatePending = false;
    syncCategoryControls(true, true);
    if (activeRoom?.row) {
      const isHost = activeRoom.row.host_player_id === activeRoom.playerId;
      submitButton.disabled = !isHost || activeRoom.players.length < 2;
      submitLabel.textContent = isHost
        ? activeRoom.row.round_number ? "Start next round" : "Start the match"
        : "Waiting for host";
    }
  }
}

function selectedCategoryIndexes() {
  return [...categoriesGrid.querySelectorAll(".category-toggle")]
    .filter((toggle) => toggle.checked)
    .map((toggle) => Number(toggle.closest(".category-card").dataset.categoryIndex));
}

function clearAnswers() {
  categoriesGrid.querySelectorAll('input[name^="answer-"]').forEach((input) => {
    input.value = "";
  });
}

function setBestScore(score) {
  try {
    const best = Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
    if (score > best) {
      localStorage.setItem(BEST_SCORE_KEY, String(score));
      bestScoreElement.textContent = String(score);
    }
  } catch (error) {
    console.warn("Could not save the personal best score.", error);
  }
}

function loadBestScore() {
  try {
    bestScoreElement.textContent = String(Number(localStorage.getItem(BEST_SCORE_KEY)) || 0);
  } catch (error) {
    console.warn("Could not load the personal best score.", error);
  }
}

function isSupabaseConfigured() {
  const settings = window.LETTER_RUSH_SUPABASE;
  return Boolean(
    settings
      && typeof settings.url === "string"
      && settings.url.startsWith("https://")
      && !settings.url.includes("YOUR_PROJECT_REF")
      && typeof settings.anonKey === "string"
      && settings.anonKey.length > 20
      && !settings.anonKey.includes("YOUR_SUPABASE"),
  );
}

function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    throw new Error("Online play is not configured yet. Follow the Supabase setup guide.");
  }
  if (!window.supabase?.createClient) {
    throw new Error("The online game library did not load. Check your internet connection and reload.");
  }
  if (!supabaseClient) {
    const settings = window.LETTER_RUSH_SUPABASE;
    supabaseClient = window.supabase.createClient(settings.url, settings.anonKey);
  }
  return supabaseClient;
}

async function ensureSignedIn() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (data.session?.user) return data.session.user;

  const { data: authData, error: authError } = await client.auth.signInAnonymously();
  if (authError) throw authError;
  if (!authData.user) throw new Error("Could not start an anonymous player session.");
  return authData.user;
}

function createCategoryInputs() {
  const selectedIndexes = new Set(selectedCategoryIndexes());
  const categories = activeRoom ? CATEGORIES.slice(0, DEFAULT_CATEGORY_COUNT) : CATEGORIES;
  return categories.map((category, index) => ({
    index,
    category: category.name,
    value: form.elements[`answer-${index}`].value.trim(),
  })).filter((answer) => activeRoom || selectedIndexes.has(answer.index));
}

async function dictionaryContainsWord(word) {
  const normalizedWord = word.toLocaleLowerCase();
  if (!dictionaryCache.has(normalizedWord)) {
    const request = fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalizedWord)}`)
      .then((response) => {
        if (response.status === 404) return false;
        if (!response.ok) throw new Error(`Dictionary lookup failed (${response.status}).`);
        return response.json().then((entries) => Array.isArray(entries) && entries.length > 0);
      })
      .catch((error) => {
        dictionaryCache.delete(normalizedWord);
        throw error;
      });
    dictionaryCache.set(normalizedWord, request);
  }
  return dictionaryCache.get(normalizedWord);
}

async function validateAnswers(answers, letter) {
  return Promise.all(answers.map(async (answer) => {
    if (!answer.value) return { ...answer, isValid: false, invalidReason: "empty" };
    if (!answer.value.toLocaleLowerCase().startsWith(letter.toLocaleLowerCase())) {
      return { ...answer, isValid: false, invalidReason: "letter" };
    }
    const category = ROOM_CATEGORY_CATALOG
      .find((option) => option.name === answer.category);
    if (category?.dictionaryCheck) {
      const words = answer.value.split(/\s+/)
        .map((word) => word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ""))
        .filter(Boolean);
      const wordChecks = await Promise.all(words.map(dictionaryContainsWord));
      if (wordChecks.some((exists) => !exists)) {
        return { ...answer, isValid: false, invalidReason: "dictionary" };
      }
    }
    return { ...answer, isValid: true, invalidReason: "" };
  }));
}

async function createAnswerFingerprints(answers) {
  if (!window.crypto?.subtle) {
    throw new Error("Secure answer matching is unavailable. Open the game over HTTPS and try again.");
  }
  return Promise.all(answers.map(async (answer) => {
    if (!answer.isValid) return "";
    const normalizedAnswer = answer.value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedAnswer));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }));
}

function setRoundLetter(letter) {
  currentLetter = letter;
  letterValue.textContent = letter;
  letterDisplay.setAttribute("aria-label", "Your letter");
  letterDisplay.classList.remove("is-counting");
  letterDisplay.classList.add("is-active");
}

function updateTimer() {
  timerValue.textContent = String(remainingSeconds);
  timer.setAttribute("aria-label", `${remainingSeconds} seconds remaining`);
  timer.classList.toggle("is-low", remainingSeconds <= 10);
  timerProgress.style.strokeDashoffset = String(106.8 * (1 - remainingSeconds / ROUND_LENGTH));
}

function startSoloRound() {
  if (roundActive || countdownInProgress) return;
  if (selectedCategoryIndexes().length === 0) {
    gameMessage.textContent = "Choose at least one category before starting.";
    return;
  }
  countdownInProgress = true;
  letterValue.textContent = "3";
  letterDisplay.setAttribute("aria-label", "Letter reveal countdown: 3");
  letterDisplay.classList.remove("is-active");
  letterDisplay.classList.add("is-counting");
  roundIndicator.className = "round-indicator active";
  roundStatus.innerHTML = `ROUND ${String(roundNumber).padStart(2, "0")} <span class="status-divider">/</span> COUNTDOWN`;
  gameMessage.textContent = "Get ready — your letter is coming up!";
  submitLabel.textContent = "Get ready…";
  submitButton.disabled = true;
  syncCategoryControls(true, true);

  let countdown = 3;
  roundTimer = window.setInterval(() => {
    countdown -= 1;
    if (countdown > 0) {
      letterValue.textContent = String(countdown);
      letterDisplay.setAttribute("aria-label", `Letter reveal countdown: ${countdown}`);
      return;
    }
    window.clearInterval(roundTimer);
    roundTimer = null;
    countdownInProgress = false;
    beginSoloRound();
  }, 1000);
}

function beginSoloRound() {
  setRoundLetter(LETTERS[Math.floor(Math.random() * LETTERS.length)]);
  remainingSeconds = ROUND_LENGTH;
  roundActive = true;

  roundIndicator.className = "round-indicator active";
  roundStatus.innerHTML = `ROUND ${String(roundNumber).padStart(2, "0")} <span class="status-divider">/</span> IN PROGRESS`;
  gameMessage.textContent = `Your letter is ${currentLetter}. Go, go, go!`;
  submitLabel.textContent = "Submit answers";
  submitButton.disabled = false;
  syncCategoryControls(false, true);
  updateTimer();
  categoriesGrid.querySelector('input[name^="answer-"]:not(:disabled)')?.focus();
  roundTimer = window.setInterval(() => {
    remainingSeconds -= 1;
    updateTimer();
    if (remainingSeconds <= 0) finishSoloRound();
  }, 1000);
}

async function finishSoloRound() {
  if (!roundActive && !roundAwaitingValidation) return;
  if (roundActive) {
    roundActive = false;
    window.clearInterval(roundTimer);
    roundTimer = null;
  }
  syncCategoryControls(true, false);
  submitButton.disabled = true;

  gameMessage.textContent = "Checking your answers…";
  let answers;
  try {
    answers = await validateAnswers(createCategoryInputs(), currentLetter);
  } catch (error) {
    console.error("Could not check answers against the dictionary.", error);
    roundAwaitingValidation = true;
    gameMessage.textContent = "Could not check your answers. Check your connection and retry.";
    submitLabel.textContent = "Retry answer check";
    submitButton.disabled = false;
    return;
  }
  roundAwaitingValidation = false;
  const validAnswers = answers.filter((answer) => answer.isValid);
  const score = validAnswers.length * POINTS_PER_ANSWER;

  answers.forEach((answer) => {
    const card = form.querySelectorAll(".category-card")[answer.index];
    card.classList.toggle("is-valid", answer.isValid);
    card.classList.toggle("is-invalid", Boolean(answer.value) && !answer.isValid);
    const feedback = document.createElement("span");
    feedback.className = "answer-feedback";
    feedback.textContent = answer.isValid ? "+10" : answer.invalidReason === "dictionary" ? "NOT FOUND" : answer.value ? "WRONG LETTER" : "SKIPPED";
    card.querySelector(".category-number").replaceWith(feedback);
  });

  roundIndicator.className = "round-indicator complete";
  roundStatus.innerHTML = `ROUND ${String(roundNumber).padStart(2, "0")} <span class="status-divider">/</span> COMPLETE`;
  gameMessage.textContent = remainingSeconds === 0 ? "Time's up! Here's your round." : "Round complete. See how you did!";
  setBestScore(score);
  showSoloResults(answers, score);
}

function showSoloResults(answers, score) {
  document.querySelector("#final-score").textContent = String(score);
  document.querySelector("#result-kicker").textContent = remainingSeconds === 0 ? "TIME'S UP" : "ROUND COMPLETE";
  document.querySelector("#result-title").textContent = score === answers.length * POINTS_PER_ANSWER ? "Perfect round!" : score >= 30 ? "Nice thinking." : score > 0 ? "Good word work." : "There's always next round.";
  document.querySelector("#result-copy").textContent = `${score / POINTS_PER_ANSWER} of ${answers.length} selected categories scored with ${currentLetter}.`;
  resultAnswers.innerHTML = answers.map((answer) => {
    const shownAnswer = answer.value || "No answer";
    const result = answer.isValid ? " · +10" : answer.invalidReason === "dictionary" ? " · NOT IN DICTIONARY" : answer.invalidReason === "letter" ? " · WRONG LETTER" : "";
    return `<div class="result-answer ${answer.isValid ? "" : "invalid"}"><span>${escapeHtml(answer.category)}</span><strong>${escapeHtml(shownAnswer)}${result}</strong></div>`;
  }).join("");
  document.querySelector("#play-again-button").querySelector("span").textContent = "Play another round";
  resultOverlay.hidden = false;
  document.querySelector("#play-again-button").focus();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function prepareNextSoloRound() {
  resultOverlay.hidden = true;
  roundNumber += 1;
  currentLetter = "";
  letterValue.textContent = "?";
  letterDisplay.setAttribute("aria-label", "Your letter");
  letterDisplay.classList.remove("is-active");
  roundIndicator.className = "round-indicator";
  roundStatus.innerHTML = `ROUND ${String(roundNumber).padStart(2, "0")} <span class="status-divider">/</span> GET READY`;
  remainingSeconds = ROUND_LENGTH;
  updateTimer();
  timer.classList.remove("is-low");
  gameMessage.textContent = "Pick your categories. The countdown starts your 60 seconds.";
  submitLabel.textContent = "Start the round";
  submitButton.disabled = false;
  clearAnswers();
  roundAwaitingValidation = false;
  syncCategoryControls(true, false);
  form.querySelectorAll(".category-card").forEach((card, index) => {
    card.classList.remove("is-valid", "is-invalid");
    const feedback = card.querySelector(".answer-feedback");
    if (feedback) {
      const number = document.createElement("span");
      number.className = "category-number";
      number.textContent = String(index + 1).padStart(2, "0");
      feedback.replaceWith(number);
    }
  });
  submitButton.focus();
}

function setRoomDialogMessage(message, isError = false) {
  roomDialogMessage.textContent = message;
  roomDialogMessage.classList.toggle("is-error", isError);
}

function openRoomDialog() {
  const inviteCode = new URLSearchParams(window.location.search).get("room");
  if (inviteCode && !roomCodeInput.value) roomCodeInput.value = inviteCode.toUpperCase();
  if (!playerNameInput.value.trim()) {
    try {
      playerNameInput.value = localStorage.getItem(DISPLAY_NAME_KEY) || "";
    } catch (error) {
      console.warn("Could not load the saved display name.", error);
    }
  }
  const configured = isSupabaseConfigured() && Boolean(window.supabase?.createClient);
  createRoomButton.disabled = !configured;
  joinRoomButton.disabled = !configured;
  document.querySelector("#online-setup-note").hidden = configured;
  if (!configured) {
    setRoomDialogMessage(
      isSupabaseConfigured()
        ? "The online game library did not load. Check your internet connection and reload."
        : "Connect a Supabase project before creating or joining online rooms.",
      true,
    );
  } else {
    setRoomDialogMessage("");
  }
  roomOverlay.hidden = false;
  playerNameInput.focus();
}

function closeRoomDialog() {
  roomOverlay.hidden = true;
}

async function createRoom() {
  setRoomBusy(true);
  setRoomDialogMessage("Creating your private room…");
  try {
    const name = playerNameInput.value.trim();
    const { error: validationError } = validatePlayerName(name);
    if (validationError) throw validationError;
    saveDisplayName(name);
    await ensureSignedIn();
    const { data, error } = await supabaseClient.rpc("create_room", { p_player_name: name });
    if (error) throw error;
    await activateRoom(data);
    closeRoomDialog();
  } catch (error) {
    console.error("Could not create the online game room.", error);
    setRoomDialogMessage(error.message || "Could not create the room. Check the setup and try again.", true);
  } finally {
    setRoomBusy(false);
  }
}

async function joinRoom() {
  setRoomBusy(true);
  setRoomDialogMessage("Joining your friend's room…");
  try {
    const name = playerNameInput.value.trim();
    const { error: validationError } = validatePlayerName(name);
    if (validationError) throw validationError;
    saveDisplayName(name);
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!/^[A-F0-9]{8}$/.test(code)) throw new Error("Enter the eight-character room code.");
    await ensureSignedIn();
    const { data, error } = await supabaseClient.rpc("join_room", {
      p_room_code: code,
      p_player_name: name,
    });
    if (error) throw error;
    await activateRoom(data);
    closeRoomDialog();
  } catch (error) {
    console.error("Could not join the online game room.", error);
    setRoomDialogMessage(error.message || "Could not join the room. Check the code and try again.", true);
  } finally {
    setRoomBusy(false);
  }
}

function validatePlayerName(name) {
  if (!name || name.length > 24) {
    return { error: new Error("Enter a name between 1 and 24 characters.") };
  }
  return { error: null };
}

function saveDisplayName(name) {
  try {
    localStorage.setItem(DISPLAY_NAME_KEY, name);
  } catch (error) {
    console.warn("Could not save the display name on this device.", error);
  }
}

function setRoomBusy(isBusy) {
  const canPlayOnline = isSupabaseConfigured() && Boolean(window.supabase?.createClient);
  createRoomButton.disabled = isBusy || !canPlayOnline;
  joinRoomButton.disabled = isBusy || !canPlayOnline;
}

async function activateRoom(roomInfo) {
  if (!roomInfo?.room_id || !roomInfo?.room_code || !roomInfo?.player_id) {
    throw new Error("Supabase returned an incomplete room. Re-run the setup SQL and try again.");
  }

  if (countdownInProgress) {
    window.clearInterval(roundTimer);
    roundTimer = null;
    countdownInProgress = false;
    letterDisplay.classList.remove("is-counting");
  }

  if (roomChannel) {
    await supabaseClient.removeChannel(roomChannel);
    roomChannel = null;
  }
  const soloCategories = CATEGORIES.slice();
  const soloSelectedCategories = new Set(selectedCategoryNames());
  categoryUpdatePending = false;
  activeRoom = {
    id: roomInfo.room_id,
    code: roomInfo.room_code,
    playerId: roomInfo.player_id,
    row: null,
    players: [],
    soloCategories,
    soloSelectedCategories,
  };
  try {
    localStorage.setItem(ROOM_STORAGE_KEY, activeRoom.code);
  } catch (error) {
    console.warn("Could not save the room for this browser session.", error);
  }

  roomPanel.hidden = false;
  roomChannel = supabaseClient
    .channel(`room:${activeRoom.id}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "rooms",
      filter: `id=eq.${activeRoom.id}`,
    }, scheduleRoomRefresh)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "room_players",
      filter: `room_id=eq.${activeRoom.id}`,
    }, scheduleRoomRefresh)
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") scheduleRoomRefresh();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        const message = error?.message || "Live room updates disconnected. Reload to reconnect.";
        console.error("The room's live connection failed.", error || message);
        roomInstruction.textContent = message;
      }
    });
  await refreshRoom();
}

function scheduleRoomRefresh() {
  if (roomRefreshTimeout) window.clearTimeout(roomRefreshTimeout);
  roomRefreshTimeout = window.setTimeout(() => {
    refreshRoom().catch((error) => {
      console.error("Could not refresh the multiplayer room.", error);
      gameMessage.textContent = `Room update failed: ${error.message}`;
    });
  }, 80);
}

async function refreshRoom() {
  if (!activeRoom) return;
  const roomId = activeRoom.id;
  const [roomResult, playersResult] = await Promise.all([
    supabaseClient.from("rooms").select("*").eq("id", roomId).single(),
    supabaseClient.from("room_players").select("*").eq("room_id", roomId).order("joined_at"),
  ]);
  if (roomResult.error) throw roomResult.error;
  if (playersResult.error) throw playersResult.error;
  if (!activeRoom || activeRoom.id !== roomId) return;

  activeRoom.row = roomResult.data;
  activeRoom.players = playersResult.data;
  const thisPlayer = activeRoom.players.find((player) => player.player_id === activeRoom.playerId);
  if (!thisPlayer) {
    clearActiveRoom();
    gameMessage.textContent = "You are no longer a member of this room.";
    return;
  }
  updateRoomView();
}

function updateRoomView() {
  const room = activeRoom?.row;
  if (!room) return;
  syncRoomCategories(room.categories);
  roomPanel.hidden = false;
  document.querySelector("#room-code").textContent = room.code;
  const playerCount = activeRoom.players.length;
  const isHost = room.host_player_id === activeRoom.playerId;
  roomInstruction.textContent = room.status === "waiting"
    ? isHost
      ? `${playerCount} of ${ROOM_PLAYER_LIMIT} players · add or remove categories before starting.`
      : `${playerCount} of ${ROOM_PLAYER_LIMIT} players · the host chooses categories.`
    : room.status === "playing"
      ? "Live round · the timer is shared with everyone."
      : isHost
        ? "Round complete · update categories before starting another."
        : "Round complete · the host can update categories or start another.";
  renderPlayers();
  roundNumber = Math.max(1, room.round_number);

  if (room.status === "playing") {
    enterSharedRound(room);
    return;
  }

  roundActive = false;
  activeClockKey = "";
  timeoutRequestPending = false;
  window.clearInterval(roundTimer);
  roundTimer = null;
  if (room.status === "waiting") {
    letterValue.textContent = "?";
    letterDisplay.setAttribute("aria-label", "Your letter");
    letterDisplay.classList.remove("is-active");
    roundIndicator.className = "round-indicator";
    roundStatus.innerHTML = `ROUND ${String(room.round_number).padStart(2, "0")} <span class="status-divider">/</span> WAITING`;
    remainingSeconds = ROUND_LENGTH;
    updateTimer();
    submitLabel.textContent = isHost ? (room.round_number ? "Start next round" : "Start the match") : "Waiting for host";
    submitButton.disabled = !isHost || playerCount < 2;
    syncCategoryControls(true, true);
    gameMessage.textContent = playerCount < 2
      ? "Invite at least one friend before starting the match."
      : isHost ? "Everyone's here. Start the match when you're ready." : "The host will start the match as soon as everyone is ready.";
    return;
  }

  roundIndicator.className = "round-indicator complete";
  roundStatus.innerHTML = `ROUND ${String(room.round_number).padStart(2, "0")} <span class="status-divider">/</span> COMPLETE`;
  submitLabel.textContent = isHost ? "Start next round" : "Waiting for host";
  submitButton.disabled = !isHost || playerCount < 2;
  syncCategoryControls(true, true);
  const endedAfterSubmissions = room.finished_at
    && room.started_at
    && new Date(room.finished_at).getTime() < new Date(room.started_at).getTime() + ROUND_LENGTH * 1000;
  gameMessage.textContent = endedAfterSubmissions
    ? isHost ? "Everyone submitted — the round ended early. Start another when you're ready." : "Everyone submitted — the round ended early. The host can start another."
    : isHost ? "Time's up. Start another round whenever your friends are ready." : "Time's up. The host can start another round when everyone's ready.";
  showSharedResults(room);
}

function renderPlayers() {
  playerList.replaceChildren();
  activeRoom.players.forEach((player) => {
    const item = document.createElement("li");
    item.className = "player-row";
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.player_name + (player.player_id === activeRoom.playerId ? " (you)" : "");
    const detail = document.createElement("span");
    detail.className = "player-detail";
    detail.textContent = activeRoom.row?.status === "playing"
      ? player.submitted_at
        ? `+${player.round_score} PTS`
        : player.is_host ? "HOST · PLAYING" : "PLAYING"
      : player.is_host
        ? "HOST"
        : `${player.total_score} PTS`;
    item.append(name, detail);
    playerList.append(item);
  });
}

function enterSharedRound(room) {
  const clockKey = `${room.id}:${room.round_number}`;
  const newRound = activeClockKey !== clockKey;
  if (newRound) {
    activeClockKey = clockKey;
    timeoutRequestPending = false;
    resultOverlay.hidden = true;
    resultShownRound = "";
    clearAnswers();
  }
  roundActive = true;
  setRoundLetter(room.letter);
  roundIndicator.className = "round-indicator active";
  roundStatus.innerHTML = `ROUND ${String(room.round_number).padStart(2, "0")} <span class="status-divider">/</span> PLAYING`;

  const thisPlayer = activeRoom.players.find((player) => player.player_id === activeRoom.playerId);
  const hasSubmitted = Boolean(thisPlayer?.submitted_at);
  syncCategoryControls(hasSubmitted, true);
  submitLabel.textContent = hasSubmitted ? "Answers submitted" : "Submit answers";
  submitButton.disabled = hasSubmitted;
  gameMessage.textContent = hasSubmitted
    ? `Answers in! You earned ${thisPlayer.round_score} points this round. Waiting for everyone to finish.`
    : `Your letter is ${room.letter}. Answers are checked when you submit.`;

  const deadline = new Date(room.started_at).getTime() + ROUND_LENGTH * 1000;
  const tick = () => {
    remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    updateTimer();
    if (remainingSeconds === 0 && !timeoutRequestPending) finishSharedRoundOnTimeout();
  };
  if (newRound || !roundTimer) {
    window.clearInterval(roundTimer);
    tick();
    roundTimer = window.setInterval(tick, 1000);
  }
}

async function startSharedRound() {
  if (!activeRoom || !activeRoom.row || activeRoom.row.host_player_id !== activeRoom.playerId || categoryUpdatePending) return;
  submitButton.disabled = true;
  submitLabel.textContent = "Starting…";
  try {
    const { error } = await supabaseClient.rpc("start_room_round", { p_room_code: activeRoom.code });
    if (error) throw error;
    await refreshRoom();
  } catch (error) {
    console.error("Could not start the shared round.", error);
    gameMessage.textContent = error.message || "Could not start the round. Try again.";
    submitButton.disabled = false;
  }
}

async function submitSharedAnswers() {
  if (!activeRoom || !activeRoom.row || activeRoom.row.status !== "playing") return;
  submitButton.disabled = true;
  submitLabel.textContent = "Checking answers…";
  try {
    const answers = await validateAnswers(createCategoryInputs(), activeRoom.row.letter);
    const answerFingerprints = await createAnswerFingerprints(answers);
    const { error } = await supabaseClient.rpc("submit_room_answers", {
      p_room_code: activeRoom.code,
      p_answers: answers.map((answer) => answer.isValid ? answer.value : ""),
      p_fingerprints: answerFingerprints,
    });
    if (error) throw error;
    await refreshRoom();
  } catch (error) {
    console.error("Could not submit the shared answers.", error);
    gameMessage.textContent = error.message || "Could not submit your answers. Try again.";
    submitButton.disabled = false;
    submitLabel.textContent = "Submit answers";
  }
}

async function finishSharedRoundOnTimeout() {
  if (!activeRoom || activeRoom.row?.status !== "playing") return;
  timeoutRequestPending = true;
  showSharedResults(activeRoom.row, true);
  gameMessage.textContent = "Time's up! Finishing the round…";
  try {
    const { data, error } = await supabaseClient.rpc("finish_room_on_timeout", {
      p_room_code: activeRoom.code,
    });
    if (error) throw error;
    if (data) await refreshRoom();
    else timeoutRequestPending = false;
  } catch (error) {
    timeoutRequestPending = false;
    console.error("Could not finish the timed-out round.", error);
    gameMessage.textContent = `Could not finish the round: ${error.message}`;
  }
}

function showSharedResults(room, provisional = false) {
  const resultKey = `${room.id}:${room.round_number}`;
  if (!provisional && resultShownRound === resultKey) return;
  if (!provisional) resultShownRound = resultKey;
  const thisPlayer = activeRoom.players.find((player) => player.player_id === activeRoom.playerId);
  const score = thisPlayer?.round_score || 0;
  document.querySelector("#final-score").textContent = String(score);
  document.querySelector("#result-kicker").textContent = provisional ? "TIME'S UP · SHARED ROOM" : "SHARED ROOM · ROUND COMPLETE";
  const perfectScore = (room.categories?.length || DEFAULT_CATEGORY_COUNT) * POINTS_PER_ANSWER;
  document.querySelector("#result-title").textContent = score === perfectScore ? "Perfect round!" : score >= 30 ? "Nice thinking." : score > 0 ? "Good word work." : "There's always next round.";
  document.querySelector("#result-copy").textContent = `Your ${room.letter} answers earned ${score} points. Here are the room scores.`;
  resultAnswers.innerHTML = [...activeRoom.players]
    .sort((first, second) => second.total_score - first.total_score)
    .map((player) => {
      const suffix = player.player_id === activeRoom.playerId ? " (you)" : "";
      return `<div class="result-answer"><span>${escapeHtml(player.player_name)}${suffix}</span><strong>+${player.round_score} · ${player.total_score} total</strong></div>`;
    })
    .join("");
  document.querySelector("#play-again-button").querySelector("span").textContent = "Back to the room";
  resultOverlay.hidden = false;
  document.querySelector("#play-again-button").focus();
}

function prepareNextRound() {
  if (activeRoom) {
    resultOverlay.hidden = true;
    submitButton.focus();
    return;
  }
  prepareNextSoloRound();
}

async function copyInviteLink() {
  if (!activeRoom) return;
  const invite = new URL(window.location.href);
  invite.searchParams.set("room", activeRoom.code);
  try {
    await navigator.clipboard.writeText(invite.toString());
    roomInstruction.textContent = "Invite link copied! Send it to your friends.";
  } catch (error) {
    console.error("Could not copy the room invite link.", error);
    roomInstruction.textContent = `Copy failed. Share room code ${activeRoom.code} instead.`;
  }
}

async function leaveRoom() {
  if (!activeRoom) return;
  try {
    const { error } = await supabaseClient.rpc("leave_room", { p_room_code: activeRoom.code });
    if (error) throw error;
    clearActiveRoom();
    resetToSolo();
  } catch (error) {
    console.error("Could not leave the multiplayer room.", error);
    gameMessage.textContent = error.message || "Could not leave the room.";
  }
}

function clearActiveRoom() {
  const soloCategories = activeRoom?.soloCategories;
  const soloSelectedCategories = activeRoom?.soloSelectedCategories;
  if (roomChannel && supabaseClient) supabaseClient.removeChannel(roomChannel);
  roomChannel = null;
  activeRoom = null;
  categoryUpdatePending = false;
  if (soloCategories) {
    CATEGORIES.splice(0, CATEGORIES.length, ...soloCategories);
    createCategoryFields(soloSelectedCategories);
    renderCategoryOptions();
  }
  roomPanel.hidden = true;
  roundActive = false;
  activeClockKey = "";
  timeoutRequestPending = false;
  window.clearInterval(roundTimer);
  roundTimer = null;
  syncCategoryControls(true, false);
  try {
    localStorage.removeItem(ROOM_STORAGE_KEY);
  } catch (error) {
    console.warn("Could not clear the saved room.", error);
  }
}

function resetToSolo() {
  resultOverlay.hidden = true;
  roundNumber = 1;
  currentLetter = "";
  letterValue.textContent = "?";
  letterDisplay.setAttribute("aria-label", "Your letter");
  letterDisplay.classList.remove("is-active", "is-counting");
  roundIndicator.className = "round-indicator";
  roundStatus.innerHTML = "ROUND 01 <span class=\"status-divider\">/</span> GET READY";
  remainingSeconds = ROUND_LENGTH;
  updateTimer();
  timer.classList.remove("is-low");
  gameMessage.textContent = "Room closed. Ready for a solo round?";
  submitLabel.textContent = "Start the round";
  submitButton.disabled = false;
  clearAnswers();
  syncCategoryControls(true, false);
  form.querySelectorAll(".category-card").forEach((card, index) => {
    card.classList.remove("is-valid", "is-invalid");
    const feedback = card.querySelector(".answer-feedback");
    if (feedback) {
      const number = document.createElement("span");
      number.className = "category-number";
      number.textContent = String(index + 1).padStart(2, "0");
      feedback.replaceWith(number);
    }
  });
}

async function restoreSavedRoom() {
  if (!isSupabaseConfigured() || !window.supabase?.createClient) return;
  let savedCode;
  try {
    savedCode = localStorage.getItem(ROOM_STORAGE_KEY);
  } catch (error) {
    console.warn("Could not restore a saved room.", error);
    return;
  }
  if (!savedCode || !/^[A-F0-9]{8}$/.test(savedCode)) return;

  try {
    const user = await ensureSignedIn();
    const client = getSupabaseClient();
    const { data, error } = await client.from("rooms").select("id, code").eq("code", savedCode).maybeSingle();
    if (error) throw error;
    if (!data) {
      localStorage.removeItem(ROOM_STORAGE_KEY);
      return;
    }
    await activateRoom({ room_id: data.id, room_code: data.code, player_id: user.id });
  } catch (error) {
    console.error("Could not restore the previous multiplayer room.", error);
    gameMessage.textContent = `Could not reconnect to your room: ${error.message}`;
  }
}

createCategoryFields();
renderCategoryOptions();
syncCategoryControls(true, false);
loadBestScore();
updateTimer();
restoreSavedRoom();

categoriesGrid.addEventListener("change", (event) => {
  if (!event.target.matches(".category-toggle")) return;
  if (countdownInProgress || roundActive || activeRoom) {
    event.target.checked = !event.target.checked;
    gameMessage.textContent = countdownInProgress || roundActive
      ? "The timer is already running — category changes are locked in."
      : "Category picks stay fixed once the room is live.";
    return;
  }
  if (selectedCategoryIndexes().length === 0) {
    event.target.checked = true;
    gameMessage.textContent = "Choose at least one category to play.";
    return;
  }
  if (!event.target.checked) {
    event.target.closest(".category-card").querySelector('input[name^="answer-"]').value = "";
  }
  syncCategoryControls(true, false);
  gameMessage.textContent = `${selectedCategoryIndexes().length} categories selected. Start when you're ready.`;
});

categoriesGrid.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove-category-button");
  if (!removeButton) return;
  removeCategory(Number(removeButton.closest(".category-card").dataset.categoryIndex));
});

addCategoryButton.addEventListener("click", () => {
  const isExpanded = addCategoryButton.getAttribute("aria-expanded") === "true";
  categoryOptions.hidden = isExpanded;
  addCategoryButton.setAttribute("aria-expanded", String(!isExpanded));
});

categoryOptions.addEventListener("click", (event) => {
  const option = event.target.closest(".category-option");
  if (!option) return;
  addCategory(option.dataset.categoryName);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (activeRoom) {
    if (activeRoom.row?.status === "playing") submitSharedAnswers();
    else if (activeRoom.row?.status === "waiting" || activeRoom.row?.status === "finished") startSharedRound();
    return;
  }
  if (roundActive) finishSoloRound();
  else if (roundAwaitingValidation) finishSoloRound();
  else startSoloRound();
});

document.querySelector("#open-room-button").addEventListener("click", openRoomDialog);
document.querySelector("#close-room-dialog-button").addEventListener("click", closeRoomDialog);
document.querySelector("#create-room-button").addEventListener("click", createRoom);
document.querySelector("#join-room-button").addEventListener("click", joinRoom);
document.querySelector("#copy-room-button").addEventListener("click", copyInviteLink);
document.querySelector("#close-room-button").addEventListener("click", leaveRoom);
document.querySelector("#play-again-button").addEventListener("click", prepareNextRound);
resultOverlay.addEventListener("click", (event) => {
  if (event.target === resultOverlay) prepareNextRound();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!roomOverlay.hidden) closeRoomDialog();
    else if (!resultOverlay.hidden) prepareNextRound();
  }
});

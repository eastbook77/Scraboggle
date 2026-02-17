// app.js
(() => {
  "use strict";

  // =========================
  // Scrabble-like letter scores
  // =========================
  const LETTER_SCORES = Object.freeze({
    A: 1, B: 3, C: 3, D: 2, E: 1,
    F: 4, G: 2, H: 4, I: 1, J: 8,
    K: 5, L: 1, M: 3, N: 1, O: 1,
    P: 3, Q: 10, R: 1, S: 1, T: 1,
    U: 1, V: 4, W: 4, X: 8, Y: 4,
    Z: 10
  });

  // =========================
  // Classic 4x4 Boggle dice (one standard list)
  // (contains "Qu" as a single face on one die)
  // Source: widely used classic Boggle (4x4) dice set
  // =========================
  const BOGGLE_DICE_4x4 = [
    ["A","A","E","E","G","N"],
    ["E","L","R","T","T","Y"],
    ["A","O","O","T","T","W"],
    ["A","B","B","J","O","O"],
    ["E","H","R","T","V","W"],
    ["C","I","M","O","T","U"],
    ["D","I","S","T","T","Y"],
    ["E","I","O","S","S","T"],
    ["D","E","L","R","V","Y"],
    ["A","C","H","O","P","S"],
    ["H","I","M","N","Qu","U"], // Qu tile
    ["E","E","I","N","S","U"],
    ["E","E","G","H","N","W"],
    ["A","F","F","K","P","S"],
    ["H","L","N","N","R","Z"],
    ["D","E","I","L","R","X"]
  ];

  // Fallback demo dictionary (small but functional)
  const DEMO_WORDS = [
    "CAT","CATS","DOG","DOGS","TREE","TREES","BIRD","BIRDS","FISH",
    "NOTE","NOTES","TONE","TONES","STONE","STONES","ONES","ONE",
    "EAT","ATE","TEA","SEA","SEAT","SEATS","EARS","EAR","ARE","AREA",
    "RATE","RATED","RATES","TAR","RAT","ART",
    "SAND","AND","HAND","HANDS","HARD","HARE","HEAR","HEARD","READ","READS",
    "QUIET","QUIT","QUITE","QUEST","QUESTION","QUEUE","QUART","QUARTS",
    "HOME","HOMES","SOME","SAME","NAME","NAMES","GAME","GAMES",
    "MIND","MINDS","TIME","TIMES","TIMER","TAME","TAMES",
    "WORD","WORDS","BOARD","BOARDS","GRID","GRIDS"
  ];

  // =========================
  // DOM
  // =========================
  const el = {
    dictDot: document.getElementById("dictDot"),
    dictText: document.getElementById("dictText"),
    startBtn: document.getElementById("startBtn"),
    nextBtn: document.getElementById("nextBtn"),
    challengeBtn: document.getElementById("challengeBtn"),
    boardWrap: document.getElementById("boardWrap"),
    board: document.getElementById("board"),
    timeLeft: document.getElementById("timeLeft"),
    totalScore: document.getElementById("totalScore"),
    wordInput: document.getElementById("wordInput"),
    submitBtn: document.getElementById("submitBtn"),
    message: document.getElementById("message"),
    wordList: document.getElementById("wordList"),
    foundCount: document.getElementById("foundCount"),
    challengeCard: document.getElementById("challengeCard"),
    challengeSummary: document.getElementById("challengeSummary"),
    statFound: document.getElementById("statFound"),
    statTotal: document.getElementById("statTotal"),
    statMaxSum: document.getElementById("statMaxSum"),
    missedCount: document.getElementById("missedCount"),
    missedList: document.getElementById("missedList")
  };

  // =========================
  // State
  // =========================
  const SIZE = 4;
  const ROUND_SECONDS = 60;
  const HIGHLIGHT_MS = 800;

  let dictionarySet = new Set();     // uppercase
  let trieRoot = null;

  let grid = [];     // 2D tiles: { display: "A"|"Qu", token: "A"|"QU", score: number }
  let accepted = new Map(); // word -> score
  let acceptedOrder = [];   // preserve order of additions
  let totalScore = 0;

  let timerId = null;
  let timeRemaining = ROUND_SECONDS;
  let roundActive = false;
  let lastFoundPathsCache = new Map(); // optional caching: word->path

  // =========================
  // Trie
  // =========================
  function makeTrieNode() {
    return { children: Object.create(null), isWord: false };
  }

  function insertTrie(root, word) {
    let node = root;
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      if (!node.children[ch]) node.children[ch] = makeTrieNode();
      node = node.children[ch];
    }
    node.isWord = true;
  }

  function buildTrie(words) {
    const root = makeTrieNode();
    for (const w of words) insertTrie(root, w);
    return root;
  }

  // =========================
  // Dictionary loading
  // =========================
  async function loadDictionary() {
    setDictStatus("loading", "Loading dictionary…");

    // Try fetch words.txt
    try {
      const res = await fetch("words.txt", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const lines = text.split(/\r?\n/);
      const words = [];
      for (const line of lines) {
        const raw = (line || "").trim().toUpperCase();
        if (!raw) continue;
        if (!/^[A-Z]+$/.test(raw)) continue;
        if (raw.length < 3) continue;
        words.push(raw);
      }
      if (words.length < 1000) {
        // still allow; but show note
        dictionarySet = new Set(words);
      } else {
        dictionarySet = new Set(words);
      }
      trieRoot = buildTrie(dictionarySet);
      setDictStatus("good", `Dictionary loaded (${dictionarySet.size.toLocaleString()} words)`);
      el.startBtn.disabled = false;
      return;
    } catch (err) {
      // fall back
    }

    // Fallback demo list
    const demoUpper = DEMO_WORDS.map(w => w.toUpperCase()).filter(w => /^[A-Z]+$/.test(w) && w.length >= 3);
    dictionarySet = new Set(demoUpper);
    trieRoot = buildTrie(dictionarySet);
    setDictStatus("warn", `Using demo dictionary (${dictionarySet.size} words). Place words.txt for full dictionary.`);
    el.startBtn.disabled = false;
  }

  function setDictStatus(kind, text) {
    el.dictText.textContent = text;
    el.dictDot.classList.remove("good", "bad");
    // kind: loading|good|warn|bad
    if (kind === "good") el.dictDot.classList.add("good");
    else if (kind === "bad") el.dictDot.classList.add("bad");
    // warn/loading keep default amber
  }

  // =========================
  // Grid generation (Boggle dice)
  // =========================
  function randInt(n) {
    return Math.floor(Math.random() * n);
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function tileFromFace(face) {
    // face can be "Qu" or "A" etc.
    const display = face === "Qu" ? "Qu" : face.toUpperCase();
    const token = face === "Qu" ? "QU" : face.toUpperCase();
    const score = (token === "QU") ? LETTER_SCORES.Q : (LETTER_SCORES[token] || 0);
    return { display, token, score };
  }

  function generateGrid() {
    const dice = BOGGLE_DICE_4x4.map(d => d.slice());
    shuffleInPlace(dice);
    const tiles = dice.map(die => tileFromFace(die[randInt(6)]));

    const g = [];
    let idx = 0;
    for (let r = 0; r < SIZE; r++) {
      const row = [];
      for (let c = 0; c < SIZE; c++) row.push(tiles[idx++]);
      g.push(row);
    }
    return g;
  }

  function renderGrid() {
    el.board.innerHTML = "";
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const t = grid[r][c];
        const div = document.createElement("div");
        div.className = "tile";
        div.setAttribute("role", "gridcell");
        div.dataset.r = String(r);
        div.dataset.c = String(c);

        const letter = document.createElement("div");
        letter.className = "letter";
        letter.textContent = t.display;

        const score = document.createElement("div");
        score.className = "scoreCorner";
        score.textContent = String(t.score);

        div.appendChild(letter);
        div.appendChild(score);
        el.board.appendChild(div);
      }
    }
  }

  function shakeBoard() {
    el.boardWrap.classList.remove("shake");
    // force reflow to restart animation
    void el.boardWrap.offsetWidth;
    el.boardWrap.classList.add("shake");
  }

  // =========================
  // Helpers: input normalization
  // =========================
  function normalizeInput(raw) {
    const trimmed = (raw || "").trim().toUpperCase();
    // Only A-Z allowed (no spaces, punctuation, etc.)
    if (!trimmed) return { ok: false, reason: "empty", word: "" };
    if (!/^[A-Z]+$/.test(trimmed)) return { ok: false, reason: "chars", word: trimmed };
    return { ok: true, reason: "", word: trimmed };
  }

  // =========================
  // Board path finding for a submitted word
  // - Handles QU tile as consuming "QU"
  // - Returns first found path as array of [r,c]
  // =========================
  const DIRS = [
    [-1,-1],[-1,0],[-1,1],
    [0,-1],        [0,1],
    [1,-1],[1,0],[1,1]
  ];

  function inBounds(r,c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function findPathForWord(word) {
    // word is uppercase A-Z
    const target = word;

    // Quick precheck: first letter(s) exist? Still need DFS for adjacency.
    const visited = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));

    function matchesTileAt(index, tileToken) {
      // index in target string
      if (tileToken === "QU") {
        return target.startsWith("QU", index);
      }
      return target[index] === tileToken;
    }

    function advanceIndex(index, tileToken) {
      return tileToken === "QU" ? index + 2 : index + 1;
    }

    function dfs(r, c, index, path) {
      const tileToken = grid[r][c].token;
      if (!matchesTileAt(index, tileToken)) return null;

      const nextIndex = advanceIndex(index, tileToken);
      visited[r][c] = true;
      path.push([r,c]);

      if (nextIndex === target.length) {
        return path.slice(); // found exact
      }

      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (!inBounds(nr, nc) || visited[nr][nc]) continue;

        // Small pruning: next must match neighbor tile at nextIndex
        const nTok = grid[nr][nc].token;
        if (!matchesTileAt(nextIndex, nTok)) continue;

        const res = dfs(nr, nc, nextIndex, path);
        if (res) return res;
      }

      path.pop();
      visited[r][c] = false;
      return null;
    }

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!matchesTileAt(0, grid[r][c].token)) continue;
        const res = dfs(r, c, 0, []);
        if (res) return res;
      }
    }
    return null;
  }

  function scorePath(path) {
    let sum = 0;
    for (const [r,c] of path) sum += grid[r][c].score;
    return sum;
  }

  // =========================
  // Highlight path
  // =========================
  function clearHighlights() {
    const tiles = el.board.querySelectorAll(".tile.highlight");
    tiles.forEach(t => t.classList.remove("highlight"));
  }

  function highlightPath(path) {
    clearHighlights();
    for (const [r,c] of path) {
      const tileEl = el.board.querySelector(`.tile[data-r="${r}"][data-c="${c}"]`);
      if (tileEl) tileEl.classList.add("highlight");
    }
    window.setTimeout(() => clearHighlights(), HIGHLIGHT_MS);
  }

  // =========================
  // UI updates
  // =========================
  function setMessage(text, kind = "muted") {
    el.message.textContent = text || "";
    el.message.classList.remove("good", "bad", "warn", "muted");
    el.message.classList.add(kind);
  }

  function resetRoundState() {
    accepted.clear();
    acceptedOrder = [];
    totalScore = 0;
    lastFoundPathsCache.clear();
    el.totalScore.textContent = "0";
    el.wordList.innerHTML = "";
    el.foundCount.textContent = "0 words";
    el.wordInput.value = "";
    setMessage("", "muted");

    el.challengeCard.hidden = true;
    el.missedList.innerHTML = "";
    el.challengeSummary.textContent = "";
    el.statFound.textContent = "0";
    el.statTotal.textContent = "0";
    el.statMaxSum.textContent = "0";
    el.missedCount.textContent = "";
  }

  function addAcceptedWord(word, score) {
    const li = document.createElement("li");
    li.className = "wordItem";
    const w = document.createElement("div");
    w.className = "w";
    w.textContent = word;
    const s = document.createElement("div");
    s.className = "s";
    s.textContent = String(score);
    li.appendChild(w);
    li.appendChild(s);
    el.wordList.prepend(li); // show newest first
  }

  function updateFoundCount() {
    const n = accepted.size;
    el.foundCount.textContent = `${n} word${n === 1 ? "" : "s"}`;
  }

  function setInputEnabled(enabled) {
    el.wordInput.disabled = !enabled;
    el.submitBtn.disabled = !enabled;
    if (enabled) {
      el.wordInput.focus();
      el.wordInput.select();
    }
  }

  // =========================
  // Timer control
  // =========================
  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function startTimer() {
    stopTimer();
    timeRemaining = ROUND_SECONDS;
    el.timeLeft.textContent = String(timeRemaining);
    roundActive = true;

    timerId = setInterval(() => {
      timeRemaining -= 1;
      if (timeRemaining < 0) timeRemaining = 0;
      el.timeLeft.textContent = String(timeRemaining);

      if (timeRemaining <= 0) {
        endRound();
      }
    }, 1000);
  }

  function endRound() {
    stopTimer();
    roundActive = false;
    setInputEnabled(false);
    setMessage(`Time! Final score: ${totalScore}`, "warn");

    el.nextBtn.hidden = false;
    el.challengeBtn.hidden = false;
  }

  // =========================
  // Challenge mode: board DFS with Trie
  // - find all distinct valid dictionary words on this grid
  // - efficiency: prefix pruning using trie during DFS
  // =========================
  function findAllWordsOnBoard() {
    // Returns Map(word -> bestScoreFound) with distinct words
    // (For scoring sum reference, bestScore is enough; but with no bonuses and
    // potential multiple paths, there might be different scores if different tiles.
    // We'll keep the MAX score per word.)
    const found = new Map();

    const visited = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));

    function stepTrie(node, tileToken) {
      // tileToken is "A".."Z" or "QU"
      if (tileToken === "QU") {
        const nQ = node.children["Q"];
        if (!nQ) return null;
        const nU = nQ.children["U"];
        if (!nU) return null;
        return nU;
      }
      return node.children[tileToken] || null;
    }

    function appendWordString(current, tileToken) {
      return tileToken === "QU" ? current + "QU" : current + tileToken;
    }

    function dfs(r, c, node, currentWord, currentScore) {
      visited[r][c] = true;

      const tile = grid[r][c];
      const nextNode = stepTrie(node, tile.token);
      if (!nextNode) {
        visited[r][c] = false;
        return;
      }

      const nextWord = appendWordString(currentWord, tile.token);
      const nextScore = currentScore + tile.score;

      // Record words (min length 3)
      if (nextNode.isWord && nextWord.length >= 3) {
        const prev = found.get(nextWord);
        if (prev === undefined || nextScore > prev) found.set(nextWord, nextScore);
      }

      // Continue exploring neighbors
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (!inBounds(nr, nc) || visited[nr][nc]) continue;
        dfs(nr, nc, nextNode, nextWord, nextScore);
      }

      visited[r][c] = false;
    }

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        dfs(r, c, trieRoot, "", 0);
      }
    }

    return found;
  }

  function showChallengeResults() {
    const all = findAllWordsOnBoard(); // Map(word->score)
    const totalPossible = all.size;
    const foundCount = accepted.size;

    // Missed words: those in all not in accepted (case-insensitive stored uppercase)
    const missed = [];
    let maxSum = 0;
    for (const [w, s] of all.entries()) {
      maxSum += s;
      if (!accepted.has(w)) missed.push([w, s]);
    }

    // sort by score desc, then alpha
    missed.sort((a,b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    el.challengeCard.hidden = false;
    el.statFound.textContent = String(foundCount);
    el.statTotal.textContent = String(totalPossible);
    el.statMaxSum.textContent = String(maxSum);

    el.challengeSummary.textContent = `${foundCount} found / ${totalPossible} possible`;
    el.missedCount.textContent = `${missed.length} missed`;

    el.missedList.innerHTML = "";
    for (const [w, s] of missed) {
      const li = document.createElement("li");
      li.className = "wordItem";
      const ww = document.createElement("div");
      ww.className = "w";
      ww.textContent = w;
      const ss = document.createElement("div");
      ss.className = "s";
      ss.textContent = String(s);
      li.appendChild(ww);
      li.appendChild(ss);
      el.missedList.appendChild(li);
    }
  }

  // =========================
  // Submission handling
  // =========================
  function reject(reasonText) {
    setMessage(reasonText, "bad");
  }

  function accept(word, score, path) {
    accepted.set(word, score);
    acceptedOrder.push(word);
    totalScore += score;
    el.totalScore.textContent = String(totalScore);

    addAcceptedWord(word, score);
    updateFoundCount();

    setMessage(`+${score}  ${word}`, "good");
    highlightPath(path);
  }

  function handleSubmit() {
    if (!roundActive) return;

    const raw = el.wordInput.value;
    const norm = normalizeInput(raw);
    if (!norm.ok) {
      if (norm.reason === "chars") reject("Invalid characters: only A–Z allowed.");
      else reject("Please enter a word.");
      return;
    }

    const word = norm.word;

    if (word.length < 3) {
      reject("Too short: minimum length is 3.");
      return;
    }

    if (accepted.has(word)) {
      reject("Duplicate: already accepted.");
      return;
    }

    if (!dictionarySet.has(word)) {
      reject("Not in dictionary.");
      return;
    }

    // Validate on board and get first path
    let path = lastFoundPathsCache.get(word) || null;
    if (!path) {
      path = findPathForWord(word);
      if (path) lastFoundPathsCache.set(word, path);
    }

    if (!path) {
      reject("Cannot be formed on this grid.");
      return;
    }

    const score = scorePath(path);
    accept(word, score, path);

    el.wordInput.value = "";
    el.wordInput.focus();
  }

  // =========================
  // Round lifecycle buttons
  // =========================
  function startRoundFresh() {
    // new grid + reset
    grid = generateGrid();
    renderGrid();
    shakeBoard();

    resetRoundState();

    // UI
    el.nextBtn.hidden = true;
    el.challengeBtn.hidden = true;

    setInputEnabled(true);
    startTimer();
    setMessage("Go!", "muted");
  }

  function nextPlayer() {
    stopTimer();
    roundActive = false;
    timeRemaining = ROUND_SECONDS;
    el.timeLeft.textContent = String(timeRemaining);

    startRoundFresh();
  }

  // =========================
  // Event listeners
  // =========================
  el.startBtn.addEventListener("click", () => {
    if (!trieRoot || dictionarySet.size === 0) return;
    startRoundFresh();
  });

  el.nextBtn.addEventListener("click", () => {
    nextPlayer();
  });

  el.challengeBtn.addEventListener("click", () => {
    if (roundActive) return;
    showChallengeResults();
    // keep buttons visible; allow re-opening results
    el.challengeCard.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  el.submitBtn.addEventListener("click", () => handleSubmit());

  el.wordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  });

  // Prevent accidental input after round ends
  el.wordInput.addEventListener("input", () => {
    // Normalize to A-Z only in real time (without rejecting yet)
    const v = el.wordInput.value;
    const upper = v.toUpperCase();
    // Allow user typing; strip non-letters
    const cleaned = upper.replace(/[^A-Z]/g, "");
    if (cleaned !== upper) {
      const start = el.wordInput.selectionStart || cleaned.length;
      el.wordInput.value = cleaned;
      try { el.wordInput.setSelectionRange(start - 1, start - 1); } catch {}
    } else {
      el.wordInput.value = upper;
    }
  });

  // =========================
  // Init
  // =========================
  function initEmptyGrid() {
    // Render placeholder grid quickly (random) but disabled until Start
    grid = generateGrid();
    renderGrid();
  }

  initEmptyGrid();
  setInputEnabled(false);
  el.nextBtn.hidden = true;
  el.challengeBtn.hidden = true;
  resetRoundState();
  loadDictionary();
})();

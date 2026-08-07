/**
 * Interface. Toute la logique de jeu lourde vit dans le worker ; ici on ne fait
 * que dessiner la grille, gerer le curseur de saisie et sauvegarder.
 */

import { SIZE, CELLS, EMPTY, BLANK, PREMIUM, LETTER_VALUES, RACK_SIZE, letterChar } from './rules.js';

const LEVEL_META = {
  facile: {
    label: 'Facile',
    tone: '#2f8f5b',
    desc: "Un mot du quotidien, deux à quatre jetons. Pour se faire l'œil.",
  },
  moyen: {
    label: 'Moyen',
    tone: '#2f6ea8',
    desc: 'Toujours un mot courant, mais il faut trouver la bonne case.',
  },
  difficile: {
    label: 'Difficile',
    tone: '#b3861e',
    desc: 'Grille chargée, gros score, et le mot peut sortir de l’ordinaire.',
  },
  extreme: {
    label: 'Extrême',
    tone: '#b3261e',
    desc: 'Un Scrabble se cache dans le tirage : les sept lettres y passent.',
  },
};

const PREMIUM_LABEL = ['', 'LD', 'LT', 'MD', 'MT'];

const $ = (id) => document.getElementById(id);
const el = {
  home: $('screen-home'),
  game: $('screen-game'),
  levels: $('levels'),
  resume: $('btn-resume'),
  resumeDetail: $('resume-detail'),
  board: $('board'),
  rack: $('rack'),
  coordsTop: $('coords-top'),
  coordsLeft: $('coords-left'),
  timer: $('timer'),
  gameLevel: $('game-level'),
  gameTarget: $('game-target'),
  currentWord: $('current-word'),
  currentScore: $('current-score'),
  message: $('message'),
  hints: $('hints'),
  attempts: $('attempts'),
  loading: $('loading'),
  loadingText: $('loading-text'),
  overlayDone: $('overlay-done'),
  doneIcon: $('done-icon'),
  doneTitle: $('done-title'),
  doneText: $('done-text'),
  doneStats: $('done-stats'),
  overlayDict: $('overlay-dict'),
  dictInput: $('dict-input'),
  dictVerdict: $('dict-verdict'),
  definition: $('definition'),
  doneDefinition: $('done-definition'),
  dictResults: $('dict-results'),
  dictCount: $('dict-count'),
  overlayBlank: $('overlay-blank'),
  alphabet: $('alphabet'),
  toast: $('toast'),
  help: $('screen-help'),
  dictSummary: $('dict-summary'),
  dictState: $('dict-state'),
  updateBanner: $('update-banner'),
  updateDetail: $('update-detail'),
  btnCheck: $('btn-dict-check'),
  btnApply: $('btn-dict-apply'),
  btnRollback: $('btn-dict-rollback'),
};

// ------------------------------------------------------------------- worker

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const pending = new Map();
let sequence = 0;

worker.onmessage = ({ data }) => {
  const entry = pending.get(data.id);
  if (!entry) return;
  pending.delete(data.id);
  if (data.error) entry.reject(new Error(data.error));
  else entry.resolve(data.result);
};

function call(type, payload) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}

// -------------------------------------------------------------------- etat

const emptyStats = () =>
  Object.fromEntries(Object.keys(LEVEL_META).map((level) => [level, { solved: 0, best: null, given: 0 }]));

let state = { stats: emptyStats(), current: null };
let cursor = null; // { cell, dir } dir 0 = horizontal, 1 = vertical
let ticker = null;
let pendingBlankIndex = null;
let previewToken = 0;

const currentPuzzle = () => state.current?.puzzle ?? null;
const placedTiles = () => state.current?.placed ?? [];

// ------------------------------------------------------------ sauvegarde

/**
 * Deux fenetres du jeu ouvertes en meme temps feraient tourner deux chronometres
 * et ecriraient tour a tour la meme sauvegarde. La plus recente se met donc en
 * retrait : elle n'affiche rien, ne compte rien, n'enregistre rien.
 */
/**
 * Identifiant propre a cette fenetre. Il doit survivre au rechargement : sinon
 * une fenetre qui reprend la main puis se recharge se presente au serveur sous
 * un nouveau nom, et se retrouve aussitot renvoyee en veille. sessionStorage est
 * exactement cela — propre a l'onglet, conserve d'un rechargement a l'autre.
 */
const sessionId = (() => {
  const existing = sessionStorage.getItem('scrabble-session');
  if (existing) return existing;
  const created = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem('scrabble-session', created);
  return created;
})();

let duplicate = false;

/** Battement de coeur : sert aussi a savoir si c'est nous qui avons la main. */
async function heartbeat({ force = false } = {}) {
  try {
    const response = await fetch(`/api/ping?id=${sessionId}${force ? '&force=1' : ''}`, { method: 'POST' });
    const { active } = await response.json();
    if (!active && !duplicate) becomeDuplicate();
    else if (active && duplicate) location.reload(); // l'autre fenetre a laché la main
    return active;
  } catch {
    return !duplicate; // serveur injoignable : on ne change rien
  }
}

function becomeDuplicate() {
  duplicate = true;
  stopTimer();

  document.body.innerHTML = `
    <div class="duplicate">
      <div class="dialog">
        <div class="dialog-icon">🪟</div>
        <h2>Le jeu est déjà ouvert</h2>
        <p>
          Une autre fenêtre du jeu est ouverte sur cet ordinateur. Pour ne pas
          fausser votre chronomètre, celle-ci reste en veille.
        </p>
        <div class="dialog-actions">
          <button class="primary" id="btn-take-over">Jouer dans cette fenêtre</button>
        </div>
        <p class="duplicate-note">
          L'autre fenêtre passera alors en veille à son tour. Vous ne perdez rien :
          la partie est enregistrée en permanence. Si l'autre fenêtre a été fermée,
          celle-ci reprendra la main toute seule en une vingtaine de secondes.
        </p>
      </div>
    </div>`;

  document.getElementById('btn-take-over').addEventListener('click', async () => {
    await heartbeat({ force: true });
    location.reload();
  });
}

let saveTimer = null;
function save({ immediate = false } = {}) {
  if (duplicate) return;
  clearTimeout(saveTimer);
  const send = () => {
    const body = JSON.stringify(state);
    if (immediate && navigator.sendBeacon) {
      navigator.sendBeacon('/api/state', new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  };
  if (immediate) send();
  else saveTimer = setTimeout(send, 600);
}

async function restore() {
  try {
    const response = await fetch('/api/state');
    if (!response.ok) return;
    const saved = await response.json();
    if (saved && typeof saved === 'object') {
      state = { stats: { ...emptyStats(), ...(saved.stats ?? {}) }, current: saved.current ?? null };
    }
  } catch {
    /* premiere ouverture : on garde l'etat neuf */
  }
}

// ------------------------------------------------------------------ helpers

const formatTime = (seconds) => {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};

const cellName = (cell) => `${String.fromCharCode(65 + (cell % SIZE))}${Math.floor(cell / SIZE) + 1}`;

function show(screen) {
  el.home.classList.toggle('hidden', screen !== 'home');
  el.game.classList.toggle('hidden', screen !== 'game');
  el.help.classList.toggle('hidden', screen !== 'help');
}

function setMessage(text, tone = '') {
  el.message.textContent = text;
  el.message.className = `message${tone ? ' ' + tone : ''}`;
}

let toastTimer = null;
function notify(text) {
  el.toast.textContent = text;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 5000);
}

/**
 * Confirmation en deux temps sur le bouton lui-meme : pas de fenetre systeme,
 * qui jure dans une fenetre sans barre d'adresse et bloque tout le reste.
 */
const armed = new WeakMap();
function armConfirm(button, label, action) {
  const pendingAction = armed.get(button);
  if (pendingAction) {
    clearTimeout(pendingAction.timer);
    button.textContent = pendingAction.idle;
    button.classList.remove('armed');
    armed.delete(button);
    action();
    return;
  }
  const idle = button.textContent;
  const timer = setTimeout(() => {
    button.textContent = idle;
    button.classList.remove('armed');
    armed.delete(button);
  }, 5000);
  armed.set(button, { idle, timer });
  button.textContent = label;
  button.classList.add('armed');
}

// -------------------------------------------------------------------- accueil

function renderHome() {
  el.levels.innerHTML = '';
  for (const [level, meta] of Object.entries(LEVEL_META)) {
    const stats = state.stats[level] ?? { solved: 0, best: null };
    const card = document.createElement('button');
    card.className = 'level';
    card.style.setProperty('--tone', meta.tone);
    card.innerHTML = `
      <span class="level-name">${meta.label}</span>
      <span class="level-desc">${meta.desc}</span>
      <span class="level-stats">
        <span><b>${stats.solved}</b>résolu${stats.solved > 1 ? 's' : ''}</span>
        <span><b>${stats.best == null ? '—' : formatTime(stats.best)}</b>meilleur temps</span>
      </span>`;
    card.addEventListener('click', () => startPuzzle(level));
    el.levels.appendChild(card);
  }

  const running = state.current && !state.current.finished;
  el.resume.classList.toggle('hidden', !running);
  if (running) {
    const meta = LEVEL_META[state.current.puzzle.level];
    el.resumeDetail.textContent = `${meta.label} · objectif ${state.current.puzzle.target} points · ${formatTime(
      state.current.elapsed
    )} écoulées`;
  }
}

// -------------------------------------------------------------- le plateau

/**
 * Taille d'une case, calculee plutot qu'estimee en CSS : la grille, les
 * coordonnees et le chevalet doivent tenir dans la fenetre sans jamais obliger
 * a faire defiler pour voir ses propres lettres.
 *
 * Hauteur occupee = en-tete + marges + (15 cases + coordonnees) + chevalet,
 * soit environ 16,5 fois la case plus une constante.
 */
function fitBoard() {
  const header = document.querySelector('.game-head')?.offsetHeight ?? 64;
  const stacked = window.innerWidth <= 1080;

  const byWidth = ((stacked ? window.innerWidth - 40 : window.innerWidth - 390) - 46) / 15.32;
  const byHeight = stacked ? Infinity : (window.innerHeight - header - 120) / 16.54;

  const cell = Math.max(20, Math.min(44, Math.floor(Math.min(byWidth, byHeight))));
  document.documentElement.style.setProperty('--cell', `${cell}px`);
}

function buildBoard() {
  const columns = document.createDocumentFragment();
  for (let col = 0; col < SIZE; col++) {
    const span = document.createElement('span');
    span.textContent = String.fromCharCode(65 + col);
    columns.appendChild(span);
  }
  el.coordsTop.appendChild(columns);

  const rows = document.createDocumentFragment();
  for (let row = 0; row < SIZE; row++) {
    const span = document.createElement('span');
    span.textContent = row + 1;
    rows.appendChild(span);
  }
  el.coordsLeft.appendChild(rows);

  const cells = document.createDocumentFragment();
  for (let cell = 0; cell < CELLS; cell++) {
    const div = document.createElement('div');
    div.className = 'cell';
    const premium = PREMIUM[cell];
    if (cell === 7 * SIZE + 7) div.classList.add('center');
    else if (premium === 1) div.classList.add('dl');
    else if (premium === 2) div.classList.add('tl');
    else if (premium === 3) div.classList.add('dw');
    else if (premium === 4) div.classList.add('tw');
    div.dataset.cell = cell;
    div.title = cellName(cell);
    div.addEventListener('click', () => onCellClick(cell));
    cells.appendChild(div);
  }
  el.board.appendChild(cells);
}

function tileMarkup(letter, isBlank, extraClass) {
  const value = isBlank ? 0 : LETTER_VALUES[letter];
  return `<div class="tile ${extraClass}${isBlank ? ' blank' : ''}">${letterChar(letter)}<span class="value">${
    value || ''
  }</span></div>`;
}

function renderBoard() {
  const puzzle = currentPuzzle();
  if (!puzzle) return;
  const placedBy = new Map(placedTiles().map((tile) => [tile.cell, tile]));
  const revealed = new Map((state.current.revealed ?? []).map((tile) => [tile.cell, tile]));

  for (let cell = 0; cell < CELLS; cell++) {
    const div = el.board.children[cell];
    const boardLetter = puzzle.board.letters[cell];
    let html = '';
    let classes = 'cell';

    const premium = PREMIUM[cell];
    if (cell === 7 * SIZE + 7) classes += ' center';
    else if (premium === 1) classes += ' dl';
    else if (premium === 2) classes += ' tl';
    else if (premium === 3) classes += ' dw';
    else if (premium === 4) classes += ' tw';

    if (boardLetter !== EMPTY) {
      html = tileMarkup(boardLetter, puzzle.board.blanks[cell] === 1, '');
    } else if (placedBy.has(cell)) {
      const tile = placedBy.get(cell);
      html = tileMarkup(tile.letter, tile.blank, 'pending');
    } else if (revealed.has(cell)) {
      const tile = revealed.get(cell);
      html = tileMarkup(tile.letter, tile.blank, 'reveal');
      classes += ' solution';
    } else {
      html = cell === 7 * SIZE + 7 ? '★' : PREMIUM_LABEL[premium];
    }

    if (cursor && cursor.cell === cell && boardLetter === EMPTY && !placedBy.has(cell)) {
      classes += ' cursor';
      div.dataset.arrow = cursor.dir === 0 ? '▸' : '▾';
    } else {
      delete div.dataset.arrow;
    }

    div.className = classes;
    div.innerHTML = html;
  }
}

function renderRack() {
  const puzzle = currentPuzzle();
  if (!puzzle) return;
  const used = new Set(placedTiles().map((tile) => tile.rackIndex));
  el.rack.innerHTML = '';

  puzzle.rack.forEach((letter, index) => {
    const div = document.createElement('div');
    div.className = `rack-tile${used.has(index) ? ' used' : ''}${letter === BLANK ? ' blank' : ''}`;
    const value = letter === BLANK ? 0 : LETTER_VALUES[letter];
    div.innerHTML = `${letterChar(letter)}<span class="value">${value || ''}</span>`;
    if (!used.has(index)) div.addEventListener('click', () => onRackClick(index));
    el.rack.appendChild(div);
  });
}

// ------------------------------------------------------------ saisie du coup

/** Prochaine case libre dans la direction courante, en sautant les jetons poses. */
function nextFreeCell(from, dir) {
  const step = dir === 0 ? 1 : SIZE;
  const puzzle = currentPuzzle();
  const occupied = new Set(placedTiles().map((tile) => tile.cell));
  let cell = from;
  while (true) {
    cell += step;
    if (cell >= CELLS) return null;
    if (dir === 0 && Math.floor(cell / SIZE) !== Math.floor(from / SIZE)) return null;
    if (puzzle.board.letters[cell] === EMPTY && !occupied.has(cell)) return cell;
  }
}

function onCellClick(cell) {
  const puzzle = currentPuzzle();
  if (!puzzle || state.current.finished) return;

  const existing = placedTiles().find((tile) => tile.cell === cell);
  if (existing) {
    state.current.placed = placedTiles().filter((tile) => tile.cell !== cell);
    cursor = { cell, dir: cursor?.dir ?? 0 };
    refresh();
    return;
  }
  if (puzzle.board.letters[cell] !== EMPTY) return;

  cursor = cursor && cursor.cell === cell ? { cell, dir: cursor.dir === 0 ? 1 : 0 } : { cell, dir: cursor?.dir ?? 0 };
  refresh();
}

function onRackClick(index) {
  const puzzle = currentPuzzle();
  if (!puzzle || state.current.finished) return;
  if (!cursor) {
    setMessage('Choisissez d’abord une case sur la grille.', 'warn');
    return;
  }
  if (puzzle.rack[index] === BLANK) {
    pendingBlankIndex = index;
    el.overlayBlank.classList.remove('hidden');
    return;
  }
  placeTile(index, puzzle.rack[index], false);
}

function placeTile(rackIndex, letter, isBlank) {
  if (!cursor) return;
  state.current.placed.push({ cell: cursor.cell, letter, blank: isBlank, rackIndex });
  const next = nextFreeCell(cursor.cell, cursor.dir);
  cursor = next == null ? null : { cell: next, dir: cursor.dir };
  refresh();
}

function removeLast() {
  const placed = placedTiles();
  if (!placed.length) return;
  const last = placed.pop();
  cursor = { cell: last.cell, dir: cursor?.dir ?? 0 };
  refresh();
}

function clearPlaced() {
  state.current.placed = [];
  cursor = null;
  refresh();
}

/** Saisie clavier : la lettre est prise dans le chevalet, ou sur un joker. */
function typeLetter(char) {
  const puzzle = currentPuzzle();
  const letter = char.toUpperCase().charCodeAt(0) - 65;
  if (letter < 0 || letter > 25) return;
  if (!cursor) {
    setMessage('Cliquez d’abord sur la case où commencer le mot.', 'warn');
    return;
  }
  const used = new Set(placedTiles().map((tile) => tile.rackIndex));

  let index = puzzle.rack.findIndex((tile, i) => tile === letter && !used.has(i));
  if (index >= 0) {
    placeTile(index, letter, false);
    return;
  }
  index = puzzle.rack.findIndex((tile, i) => tile === BLANK && !used.has(i));
  if (index >= 0) {
    placeTile(index, letter, true);
    setMessage(`Le joker prend la valeur ${String.fromCharCode(65 + letter)} (0 point).`, 'warn');
    return;
  }
  setMessage(`Pas de ${String.fromCharCode(65 + letter)} disponible dans le tirage.`, 'error');
}

// ------------------------------------------------------------------ apercu

async function refresh() {
  renderBoard();
  renderRack();
  await updatePreview();
  save();
}

async function updatePreview() {
  const placed = placedTiles();
  if (!placed.length) {
    el.currentWord.textContent = '—';
    el.currentScore.textContent = '0';
    return;
  }

  const token = ++previewToken;
  const verdict = await call('check', {
    board: currentPuzzle().board,
    placements: placed.map(({ cell, letter, blank }) => ({ cell, letter, blank })),
  });
  if (token !== previewToken) return;

  if (verdict.ok) {
    el.currentWord.textContent = verdict.words.map((word) => word.word).join(' + ');
    el.currentScore.textContent = verdict.score;
  } else {
    el.currentWord.textContent = placed
      .slice()
      .sort((a, b) => a.cell - b.cell)
      .map((tile) => letterChar(tile.letter))
      .join('');
    el.currentScore.textContent = '0';
  }
}

// ------------------------------------------------------------------- parties

async function startPuzzle(level) {
  el.loadingText.textContent = 'Composition d’une grille…';
  el.loading.classList.remove('hidden');
  try {
    const puzzle = await call('puzzle', { level });
    state.current = {
      puzzle,
      placed: [],
      revealed: [],
      elapsed: 0,
      attempts: 0,
      hintsUsed: 0,
      bestAttempt: null,
      finished: false,
    };
    cursor = null;
    openGame();
    setMessage('Cliquez sur une case pour poser votre premier jeton, ou tapez les lettres au clavier.');
    save({ immediate: true });
  } catch (error) {
    notify(error.message);
  } finally {
    el.loading.classList.add('hidden');
  }
}

function openGame() {
  const puzzle = currentPuzzle();
  const meta = LEVEL_META[puzzle.level];
  el.gameLevel.textContent = meta.label;
  el.gameLevel.style.setProperty('--tone', meta.tone);
  el.gameTarget.textContent = puzzle.target;
  el.hints.innerHTML = '';
  for (let i = 0; i < (state.current.hintsUsed ?? 0); i++) addHintRow(puzzle.hints[i]);

  show('game');
  fitBoard();
  renderBoard();
  renderRack();
  updatePreview();
  renderAttempts();
  el.timer.textContent = formatTime(state.current.elapsed);
  if (state.current.finished) stopTimer();
  else startTimer();
}

function startTimer() {
  stopTimer();
  ticker = setInterval(() => {
    if (!state.current || state.current.finished) return;
    state.current.elapsed += 1;
    el.timer.textContent = formatTime(state.current.elapsed);
    if (state.current.elapsed % 10 === 0) save();
  }, 1000);
}

function stopTimer() {
  clearInterval(ticker);
  ticker = null;
}

function renderAttempts() {
  const current = state.current;
  if (!current) return;
  const parts = [];
  if (current.attempts) parts.push(`${current.attempts} essai${current.attempts > 1 ? 's' : ''}`);
  if (current.bestAttempt) parts.push(`meilleur : ${current.bestAttempt.word} à ${current.bestAttempt.score} pts`);
  el.attempts.textContent = parts.join(' · ');
}

async function validateMove() {
  const current = state.current;
  if (!current || current.finished) return;
  if (!current.placed.length) {
    setMessage('Posez d’abord des jetons sur la grille.', 'warn');
    return;
  }

  const verdict = await call('check', {
    board: current.puzzle.board,
    placements: current.placed.map(({ cell, letter, blank }) => ({ cell, letter, blank })),
  });

  if (!verdict.ok) {
    setMessage(verdict.error, 'error');
    return;
  }

  current.attempts += 1;
  const word = verdict.words[0].word;
  if (!current.bestAttempt || verdict.score > current.bestAttempt.score) {
    current.bestAttempt = { word, score: verdict.score };
  }

  if (verdict.score >= current.puzzle.target) {
    win(verdict);
  } else {
    const gap = current.puzzle.target - verdict.score;
    setMessage(
      `${word} vaut ${verdict.score} points — c’est valable, mais il manque ${gap} point${
        gap > 1 ? 's' : ''
      } pour le meilleur coup. Réessayez !`,
      'warn'
    );
  }
  renderAttempts();
  save();
}

function win(verdict) {
  const current = state.current;
  current.finished = true;
  current.won = true;
  stopTimer();

  const stats = state.stats[current.puzzle.level];
  stats.solved += 1;
  const clean = current.hintsUsed === 0;
  if (clean && (stats.best == null || current.elapsed < stats.best)) stats.best = current.elapsed;

  el.doneIcon.textContent = '🏆';
  el.doneTitle.textContent = 'Trouvé !';
  el.doneText.innerHTML = `<b>${verdict.words[0].word}</b> pour <b>${verdict.score} points</b>, c’est le meilleur coup possible.${
    clean ? '' : ' (indice utilisé : le temps ne compte pas pour le record)'
  }`;
  el.doneStats.innerHTML = `
    <div><b>${formatTime(current.elapsed)}</b>temps</div>
    <div><b>${verdict.score}</b>points</div>
    <div><b>${current.attempts}</b>essai${current.attempts > 1 ? 's' : ''}</div>`;
  el.overlayDone.classList.remove('hidden');
  showDefinition(el.doneDefinition, verdict.words[0].word);
  setMessage('Bravo, c’était le meilleur coup !', 'good');
  save({ immediate: true });
}

function giveUp() {
  const current = state.current;
  if (!current || current.finished) return;
  current.finished = true;
  current.won = false;
  current.placed = [];
  current.revealed = current.puzzle.solution.tiles;
  stopTimer();
  state.stats[current.puzzle.level].given += 1;

  const solution = current.puzzle.solution;
  el.doneIcon.textContent = '💡';
  el.doneTitle.textContent = 'La solution';
  el.doneText.innerHTML = `Le meilleur coup était <b>${solution.word}</b> en ${cellName(solution.start)}, ${
    solution.dir === 0 ? 'à l’horizontale' : 'à la verticale'
  }, pour <b>${current.puzzle.target} points</b>.${
    solution.isCommon ? '' : ' (un mot rare — même les bons joueurs le manquent)'
  }`;
  el.doneStats.innerHTML = `
    <div><b>${formatTime(current.elapsed)}</b>temps</div>
    <div><b>${current.puzzle.target}</b>points</div>
    <div><b>${current.bestAttempt ? current.bestAttempt.score : 0}</b>votre max</div>`;
  // Les coups suivants sont plus instructifs que la seule solution : ils montrent
  // ce qu'on aurait pu jouer et combien ca coutait de passer a cote.
  const others = (current.puzzle.podium ?? []).slice(1, 4);
  if (others.length) {
    el.doneText.innerHTML += `<br><span class="podium">Ensuite venaient ${others
      .map((entry) => `<b>${entry.word}</b> (${entry.score})`)
      .join(', ')}.</span>`;
  }

  el.overlayDone.classList.remove('hidden');
  showDefinition(el.doneDefinition, solution.word);
  renderBoard();
  save({ immediate: true });
}

function addHintRow(text) {
  const li = document.createElement('li');
  li.textContent = text;
  el.hints.appendChild(li);
}

function useHint() {
  const current = state.current;
  if (!current || current.finished) return;
  const hints = current.puzzle.hints ?? [];
  if (current.hintsUsed >= hints.length) {
    setMessage('Plus d’indice disponible — il ne reste qu’à chercher, ou à voir la solution.', 'warn');
    return;
  }
  addHintRow(hints[current.hintsUsed]);
  current.hintsUsed += 1;
  save();
}

function backToMenu() {
  stopTimer();
  el.overlayDone.classList.add('hidden');
  if (state.current?.finished) state.current = null;
  renderHome();
  show('home');
  save({ immediate: true });
}

// ------------------------------------------------- le dictionnaire installe

let manifest = null;
let hasBackup = false;
let available = null; // resultat d'une verification, si une liste plus recente existe

const formatCount = (value) => Number(value ?? 0).toLocaleString('fr-FR');

async function loadManifest() {
  try {
    const status = await fetch('/api/dict/status').then((r) => r.json());
    manifest = status.manifest;
    hasBackup = Boolean(status.hasBackup);
  } catch {
    manifest = null;
    hasBackup = false;
  }
  renderDictSummary();
}

function renderDictSummary() {
  if (!manifest) {
    el.dictSummary.textContent = 'Dictionnaire installé : informations indisponibles.';
    el.dictCount.textContent = '';
    return;
  }
  const posables = manifest.playable ?? manifest.words;
  el.dictSummary.innerHTML =
    `L'application connaît <b>${formatCount(manifest.words)} mots</b>, ` +
    `c'est-à-dire toutes les formes autorisées : les pluriels, les féminins et ` +
    `toutes les formes conjuguées comptent chacune pour un mot. ` +
    `<b>${formatCount(posables)}</b> d'entre eux font 15 lettres ou moins et peuvent ` +
    `donc tenir sur le plateau.<br><br>${manifest.source?.label ?? ''}`;
  el.dictCount.textContent = `${manifest.source?.id?.toUpperCase() ?? 'Dictionnaire'} · ${formatCount(
    manifest.words
  )} mots disponibles hors ligne`;
}

function setDictState(text, tone = '') {
  el.dictState.innerHTML = text;
  el.dictState.className = `dict-state${tone ? ' ' + tone : ''}`;
}

function renderUpdateBanner() {
  const show = Boolean(available);
  el.updateBanner.classList.toggle('hidden', !show);
  if (show) {
    el.updateDetail.textContent =
      `${formatCount(available.words)} mots au lieu de ${formatCount(available.installedWords)} ` +
      `— cliquez pour voir le détail.`;
  }
}

/**
 * Verification silencieuse au demarrage : sans reseau on ne dit rien, et rien
 * n'est jamais installe sans un clic. La liste actuelle n'est jamais touchee ici.
 */
async function checkDictionary({ silent = true } = {}) {
  if (!silent) setDictState('Vérification en cours…');
  let result;
  try {
    result = await fetch('/api/dict/check', { method: 'POST' }).then((r) => r.json());
  } catch {
    if (!silent) setDictState("Impossible de joindre la source (pas de connexion ?). Le dictionnaire actuel reste en place.", 'bad');
    return;
  }

  if (!result.ok) {
    available = null;
    if (!silent) setDictState(`Mise à jour refusée : ${result.error}<br>Le dictionnaire actuel n'a pas été touché.`, 'bad');
    renderUpdateBanner();
    return;
  }

  if (result.status === 'offline') {
    available = null;
    if (!silent) {
      setDictState(
        "Pas de connexion internet pour l'instant. Ce n'est pas grave : le jeu et le dictionnaire fonctionnent entièrement hors ligne.",
        ''
      );
    }
    renderUpdateBanner();
    return;
  }

  if (result.status === 'current') {
    available = null;
    if (!silent) setDictState('✓ Votre dictionnaire est à jour, il n’y a rien de nouveau.', 'good');
    renderUpdateBanner();
    return;
  }

  available = result;
  const sens = result.words >= result.installedWords ? 'plus récente' : 'différente';
  setDictState(
    `Une liste ${sens} est disponible : <b>${formatCount(result.words)} mots</b> ` +
      `contre ${formatCount(result.installedWords)} aujourd'hui.<br>` +
      `<b>${formatCount(result.added)} mots ajoutés</b>` +
      (result.addedSample?.length ? ` (${result.addedSample.slice(0, 5).join(', ')}…)` : '') +
      `<br><b>${formatCount(result.removed)} mots retirés</b>` +
      (result.removedSample?.length ? ` (${result.removedSample.slice(0, 5).join(', ')}…)` : '') +
      `<br><br>Votre liste actuelle sera conservée : vous pourrez revenir en arrière.`,
    'news'
  );
  el.btnApply.classList.remove('hidden');
  renderUpdateBanner();
}

async function applyDictionary() {
  el.btnApply.disabled = true;
  setDictState('Installation en cours, quelques secondes…');
  let result;
  try {
    result = await fetch('/api/dict/apply', { method: 'POST' }).then((r) => r.json());
  } catch {
    result = { ok: false, error: 'le serveur n’a pas répondu' };
  }
  el.btnApply.disabled = false;

  if (!result.ok) {
    setDictState(`L'installation a échoué : ${result.error}<br>Rien n'a été modifié, vous pouvez continuer à jouer.`, 'bad');
    return;
  }

  available = null;
  el.btnApply.classList.add('hidden');
  renderUpdateBanner();
  setDictState(
    `✓ Nouvelle liste installée : <b>${formatCount(result.words)} mots</b>.<br>` +
      `L'application va se recharger pour en tenir compte.`,
    'good'
  );
  save({ immediate: true });
  setTimeout(() => location.reload(), 1800);
}

async function rollbackDictionary() {
  setDictState('Restauration…');
  const result = await fetch('/api/dict/rollback', { method: 'POST' }).then((r) => r.json());
  if (!result.ok) {
    setDictState(`Impossible de restaurer : ${result.error}`, 'bad');
    return;
  }
  setDictState(`✓ Liste précédente restaurée (${formatCount(result.words)} mots). Rechargement…`, 'good');
  save({ immediate: true });
  setTimeout(() => location.reload(), 1500);
}

async function openHelp() {
  show('help');
  await loadManifest();
  el.btnRollback.classList.toggle('hidden', !hasBackup);
  if (available) checkDictionary({ silent: false });
  else setDictState('');
}

// -------------------------------------------------------------- dictionnaire

let lookupTimer = null;
let definitionToken = 0;

/**
 * Le sens d'un mot vient du Wiktionnaire, a la demande. Les mots deja consultes
 * sont gardes en cache par le serveur et restent donc lisibles hors ligne ; les
 * autres ne s'affichent tout simplement pas s'il n'y a pas de connexion.
 */
async function showDefinition(target, word) {
  const token = ++definitionToken;
  target.className = 'definition loading-def';
  target.textContent = 'Recherche du sens…';
  target.classList.remove('hidden');

  let result;
  try {
    result = await fetch(`/api/define?mot=${encodeURIComponent(word)}`).then((r) => r.json());
  } catch {
    result = { ok: false };
  }
  if (token !== definitionToken) return;

  if (!result.ok || !result.entries?.length) {
    target.classList.add('hidden');
    return;
  }

  target.className = 'definition';
  target.innerHTML = result.entries
    .map((entry) => {
      const base = entry.base
        ? `<div class="definition-base"><b>${entry.base.title}</b> — ${entry.base.text}</div>`
        : '';
      return `<div class="definition-entry">
          <b>${entry.title}</b>${entry.kind ? ` <i>${entry.kind}</i>` : ''} — ${entry.text}${base}
        </div>`;
    })
    .join('');
}

function openDictionary() {
  el.overlayDict.classList.remove('hidden');
  el.dictInput.focus();
  el.dictInput.select();
}

function closeDictionary() {
  el.overlayDict.classList.add('hidden');
}

async function runLookup() {
  const query = el.dictInput.value.trim();
  if (!query) {
    el.dictVerdict.classList.add('hidden');
    el.dictResults.innerHTML = '';
    return;
  }

  const result = await call('lookup', { query });
  if (el.dictInput.value.trim().toUpperCase().replace(/[^A-Z?*]/g, '') !== result.query) return;

  if (result.valid === true) showDefinition(el.definition, result.query);
  else {
    definitionToken++;
    el.definition.classList.add('hidden');
  }

  if (result.valid === null) {
    el.dictVerdict.classList.add('hidden');
  } else {
    el.dictVerdict.className = `verdict ${result.valid ? 'yes' : 'no'}`;
    el.dictVerdict.textContent = result.valid
      ? `✓ ${result.query} est valable au Scrabble${result.common ? '' : ' (mot peu courant)'}`
      : `✗ ${result.query} n’existe pas dans le dictionnaire`;
  }

  const groups = [];
  if (result.matches.length) {
    groups.push({ title: `${result.matches.length} mot(s) correspondant au motif`, words: result.matches });
  }
  if (result.anagrams.length) {
    groups.push({
      title: `${result.anagrams.length} mot(s) composables avec ces lettres`,
      words: result.anagrams.slice(0, 300),
    });
  }

  el.dictResults.innerHTML = groups
    .map(
      (group) => `<div class="dict-group"><h3>${group.title}</h3><div class="words">${group.words
        .map((word) => `<span class="${word.length >= 7 ? 'strong' : ''}">${word}</span>`)
        .join('')}</div></div>`
    )
    .join('');

  // Un clic sur un mot trouve le remet dans la recherche : c'est la facon la plus
  // naturelle d'en demander le sens quand on parcourt une liste d'anagrammes.
  for (const chip of el.dictResults.querySelectorAll('.words span')) {
    chip.addEventListener('click', () => {
      el.dictInput.value = chip.textContent;
      runLookup();
    });
  }
}

// -------------------------------------------------------------------- clavier

document.addEventListener('keydown', (event) => {
  if (!el.overlayBlank.classList.contains('hidden')) {
    if (event.key === 'Escape') closeBlank();
    else if (/^[a-zA-Z]$/.test(event.key)) chooseBlank(event.key.toUpperCase().charCodeAt(0) - 65);
    event.preventDefault();
    return;
  }

  if (!el.overlayDict.classList.contains('hidden')) {
    if (event.key === 'Escape') closeDictionary();
    return;
  }

  if (!el.overlayDone.classList.contains('hidden')) {
    if (event.key === 'Escape' || event.key === 'Enter') backToMenu();
    return;
  }

  if (event.key.toLowerCase() === 'd' && (event.ctrlKey || event.altKey)) {
    event.preventDefault();
    openDictionary();
    return;
  }

  if (!el.help.classList.contains('hidden')) {
    if (event.key === 'Escape') {
      renderHome();
      show('home');
    }
    return;
  }

  if (el.game.classList.contains('hidden')) return;
  const current = state.current;
  if (!current || current.finished) return;

  if (/^[a-zA-Z]$/.test(event.key)) {
    event.preventDefault();
    typeLetter(event.key);
  } else if (event.key === 'Backspace') {
    event.preventDefault();
    removeLast();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    validateMove();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    clearPlaced();
  } else if (event.key.startsWith('Arrow') && cursor) {
    event.preventDefault();
    const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -SIZE, ArrowDown: SIZE };
    const next = cursor.cell + deltas[event.key];
    if (next >= 0 && next < CELLS) {
      if (event.key === 'ArrowLeft' && cursor.cell % SIZE === 0) return;
      if (event.key === 'ArrowRight' && cursor.cell % SIZE === SIZE - 1) return;
      cursor = { cell: next, dir: event.key === 'ArrowUp' || event.key === 'ArrowDown' ? 1 : 0 };
      renderBoard();
    }
  }
});

// ---------------------------------------------------------------------- joker

function buildAlphabet() {
  for (let letter = 0; letter < 26; letter++) {
    const button = document.createElement('button');
    button.textContent = String.fromCharCode(65 + letter);
    button.addEventListener('click', () => chooseBlank(letter));
    el.alphabet.appendChild(button);
  }
}

function chooseBlank(letter) {
  if (pendingBlankIndex == null) return;
  placeTile(pendingBlankIndex, letter, true);
  closeBlank();
}

function closeBlank() {
  pendingBlankIndex = null;
  el.overlayBlank.classList.add('hidden');
}

// ------------------------------------------------------------------ branchements

$('btn-menu').addEventListener('click', backToMenu);
$('btn-done-menu').addEventListener('click', backToMenu);
$('btn-again').addEventListener('click', () => {
  const level = state.current.puzzle.level;
  el.overlayDone.classList.add('hidden');
  state.current = null;
  startPuzzle(level);
});
$('btn-validate').addEventListener('click', validateMove);
$('btn-clear').addEventListener('click', clearPlaced);
$('btn-hint').addEventListener('click', useHint);
$('btn-give-up').addEventListener('click', (event) =>
  armConfirm(event.currentTarget, 'Sûr ? Le problème ne comptera pas', giveUp)
);
$('btn-help').addEventListener('click', openHelp);
$('btn-help-back').addEventListener('click', () => {
  renderHome();
  show('home');
});
$('update-banner').addEventListener('click', openHelp);
el.btnCheck.addEventListener('click', () => checkDictionary({ silent: false }));
el.btnApply.addEventListener('click', (event) =>
  armConfirm(event.currentTarget, 'Confirmer l’installation', applyDictionary)
);
el.btnRollback.addEventListener('click', (event) =>
  armConfirm(event.currentTarget, 'Confirmer le retour en arrière', rollbackDictionary)
);
$('btn-dict-home').addEventListener('click', openDictionary);
$('btn-dict-game').addEventListener('click', openDictionary);
$('btn-dict-close').addEventListener('click', closeDictionary);
$('btn-blank-cancel').addEventListener('click', closeBlank);
$('btn-resume').addEventListener('click', () => openGame());
$('btn-reset').addEventListener('click', (event) =>
  armConfirm(event.currentTarget, 'Sûr ? Tous les temps seront effacés', () => {
    state.stats = emptyStats();
    renderHome();
    save({ immediate: true });
    notify('Statistiques remises à zéro.');
  })
);

el.dictInput.addEventListener('input', () => {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(runLookup, 160);
});

for (const overlay of [el.overlayDict, el.overlayBlank]) {
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.classList.add('hidden');
  });
}

window.addEventListener('resize', () => {
  if (!el.game.classList.contains('hidden')) fitBoard();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save({ immediate: true });
});
window.addEventListener('pagehide', () => save({ immediate: true }));

// Assez frequent pour que le serveur ne croie jamais la fenetre abandonnee, et
// pour qu'une fenetre en veille reprenne vite la main si l'autre a ete fermee.
setInterval(heartbeat, 6000);

// ------------------------------------------------------------------ demarrage

(async function boot() {
  // Avant tout : est-ce a nous de jouer ? Inutile de charger le dictionnaire
  // pour une fenetre qui restera en veille.
  if (!(await heartbeat())) {
    el.loading.classList.add('hidden');
    return;
  }

  buildBoard();
  buildAlphabet();
  await Promise.all([restore(), call('init'), loadManifest()]);
  renderHome();
  show('home');
  el.loading.classList.add('hidden');

  // Verification discrete de la liste de mots, une fois l'application utilisable.
  // Sans reseau elle ne dit rien, et n'installe jamais quoi que ce soit seule.
  setTimeout(() => checkDictionary({ silent: true }), 2500);
})();

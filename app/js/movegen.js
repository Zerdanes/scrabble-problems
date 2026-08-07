/**
 * Generation exhaustive des coups legaux (Appel & Jacobson).
 *
 * Pour chaque direction on parcourt les 15 lignes. Sur chaque ligne on repere les
 * "ancres" (cases vides touchant un jeton deja pose), on precalcule pour chacune
 * les lettres autorisees par le mot perpendiculaire, puis on etend a gauche depuis
 * l'ancre avant d'etendre a droite le long du DAWG.
 *
 * Une ligne est indexee par (line, pos) : en horizontal line = rangee et pos =
 * colonne, en vertical l'inverse. Dans les deux cas les voisins perpendiculaires
 * d'une case sont (line - 1, pos) et (line + 1, pos), ce qui permet d'ecrire
 * l'algorithme une seule fois.
 */

import { ROOT } from './dawg.js';
import {
  SIZE,
  CELLS,
  CENTER,
  EMPTY,
  BLANK,
  RACK_SIZE,
  BINGO_BONUS,
  PREMIUM,
  LETTER_VALUES,
} from './rules.js';

const ALL_LETTERS = 0x3ffffff; // 26 bits a 1

const horizontal = (line, pos) => line * SIZE + pos;
const vertical = (line, pos) => pos * SIZE + line;

/** Cases vides adjacentes a un jeton pose. Sur un plateau vide : la case centrale. */
function findAnchors(letters) {
  const anchors = new Uint8Array(CELLS);
  let occupiedCount = 0;
  for (let cell = 0; cell < CELLS; cell++) if (letters[cell] !== EMPTY) occupiedCount++;

  if (occupiedCount === 0) {
    anchors[CENTER] = 1;
    return anchors;
  }

  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const cell = row * SIZE + col;
      if (letters[cell] !== EMPTY) continue;
      const touches =
        (row > 0 && letters[cell - SIZE] !== EMPTY) ||
        (row < SIZE - 1 && letters[cell + SIZE] !== EMPTY) ||
        (col > 0 && letters[cell - 1] !== EMPTY) ||
        (col < SIZE - 1 && letters[cell + 1] !== EMPTY);
      if (touches) anchors[cell] = 1;
    }
  }
  return anchors;
}

/**
 * Tous les coups jouables. `rack` est un tableau de lettres (0-25, ou BLANK).
 * Le resultat est trie par score decroissant.
 */
export function generateMoves(dawg, board, rack) {
  const anchors = findAnchors(board.letters);
  const moves = [];
  collectDirection(dawg, board, rack, anchors, 0, moves);
  collectDirection(dawg, board, rack, anchors, 1, moves);

  // Un jeton unique qui forme un mot dans les deux sens est trouve deux fois.
  const seen = new Set();
  const unique = [];
  for (const move of moves) {
    const key = move.tiles.map((tile) => `${tile.cell}:${tile.letter}:${tile.blank ? 1 : 0}`).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(move);
  }

  unique.sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
  return unique;
}

function collectDirection(dawg, board, rack, anchors, dir, out) {
  const { letters, blanks } = board;
  const at = dir === 0 ? horizontal : vertical;

  const rackCounts = new Int8Array(27);
  for (const letter of rack) rackCounts[letter === BLANK ? 26 : letter]++;
  const rackSize = rack.length;

  // --- controles croises : uniquement utiles sur les ancres, les autres cases
  // vides n'ont par definition aucun voisin perpendiculaire.
  const crossMask = new Int32Array(CELLS).fill(ALL_LETTERS);
  const crossScore = new Int16Array(CELLS);
  const crossHas = new Uint8Array(CELLS);

  for (let line = 0; line < SIZE; line++) {
    for (let pos = 0; pos < SIZE; pos++) {
      const cell = at(line, pos);
      if (!anchors[cell]) continue;

      const before = [];
      for (let k = line - 1; k >= 0 && letters[at(k, pos)] !== EMPTY; k--) before.unshift(at(k, pos));
      const after = [];
      for (let k = line + 1; k < SIZE && letters[at(k, pos)] !== EMPTY; k++) after.push(at(k, pos));
      if (!before.length && !after.length) continue;

      crossHas[cell] = 1;
      let score = 0;
      for (const c of before) score += blanks[c] ? 0 : LETTER_VALUES[letters[c]];
      for (const c of after) score += blanks[c] ? 0 : LETTER_VALUES[letters[c]];
      crossScore[cell] = score;

      let node = ROOT;
      for (const c of before) {
        const edge = dawg.findEdge(node, letters[c]);
        node = edge < 0 ? -1 : dawg.target(edge);
        if (node < 0) break;
      }
      if (node < 0) {
        crossMask[cell] = 0;
        continue;
      }

      let mask = 0;
      for (let edge = node; ; edge++) {
        if (after.length === 0) {
          if (dawg.isWord(edge)) mask |= 1 << dawg.letter(edge);
        } else {
          let next = dawg.target(edge);
          let lastEdge = -1;
          for (const c of after) {
            const step = next < 0 ? -1 : dawg.findEdge(next, letters[c]);
            if (step < 0) {
              lastEdge = -1;
              break;
            }
            lastEdge = step;
            next = dawg.target(step);
          }
          if (lastEdge >= 0 && dawg.isWord(lastEdge)) mask |= 1 << dawg.letter(edge);
        }
        if (dawg.isLast(edge)) break;
      }
      crossMask[cell] = mask;
    }
  }

  // --- parcours des lignes
  const placedLetters = new Int8Array(SIZE);
  const placedBlanks = new Uint8Array(SIZE);
  let line = 0;
  let anchorPos = 0;

  const record = (startPos, endPos) => {
    let sum = 0;
    let wordMultiplier = 1;
    let crossTotal = 0;
    let placedCount = 0;
    let word = '';
    const tiles = [];

    for (let pos = startPos; pos <= endPos; pos++) {
      const cell = at(line, pos);
      const isNew = placedLetters[pos] !== EMPTY;
      const letter = isNew ? placedLetters[pos] : letters[cell];
      const isBlank = isNew ? placedBlanks[pos] === 1 : blanks[cell] === 1;
      word += String.fromCharCode(65 + letter);

      let value = isBlank ? 0 : LETTER_VALUES[letter];
      if (isNew) {
        const premium = PREMIUM[cell];
        if (premium === 1) value *= 2;
        else if (premium === 2) value *= 3;
        const wordFactor = premium === 3 ? 2 : premium === 4 ? 3 : 1;
        wordMultiplier *= wordFactor;
        placedCount++;
        tiles.push({ cell, letter, blank: isBlank });
        if (crossHas[cell]) crossTotal += (crossScore[cell] + value) * wordFactor;
      }
      sum += value;
    }

    out.push({
      dir,
      word,
      tiles,
      start: at(line, startPos),
      end: at(line, endPos),
      score: sum * wordMultiplier + crossTotal + (placedCount === RACK_SIZE ? BINGO_BONUS : 0),
    });
  };

  const extendRight = (node, pos, startPos, isWordHere) => {
    if (pos >= SIZE || letters[at(line, pos)] === EMPTY) {
      if (isWordHere && pos > anchorPos) record(startPos, pos - 1);
      if (pos >= SIZE || node < 0) return;

      const cell = at(line, pos);
      const allowed = crossMask[cell];
      if (allowed === 0) return;

      for (let edge = node; ; edge++) {
        const letter = dawg.letter(edge);
        if (allowed & (1 << letter)) {
          const target = dawg.target(edge);
          const isWord = dawg.isWord(edge);
          if (rackCounts[letter] > 0) {
            rackCounts[letter]--;
            placedLetters[pos] = letter;
            placedBlanks[pos] = 0;
            extendRight(target, pos + 1, startPos, isWord);
            placedLetters[pos] = EMPTY;
            rackCounts[letter]++;
          }
          if (rackCounts[26] > 0) {
            rackCounts[26]--;
            placedLetters[pos] = letter;
            placedBlanks[pos] = 1;
            extendRight(target, pos + 1, startPos, isWord);
            placedLetters[pos] = EMPTY;
            placedBlanks[pos] = 0;
            rackCounts[26]++;
          }
        }
        if (dawg.isLast(edge)) break;
      }
      return;
    }

    const edge = dawg.findEdge(node, letters[at(line, pos)]);
    if (edge >= 0) extendRight(dawg.target(edge), pos + 1, startPos, dawg.isWord(edge));
  };

  /** Pose des jetons du chevalet sur [startPos, anchorPos - 1] avant d'etendre. */
  const buildPrefix = (pos, node, startPos) => {
    if (pos === anchorPos) {
      extendRight(node, pos, startPos, false);
      return;
    }
    if (node < 0) return;
    for (let edge = node; ; edge++) {
      const letter = dawg.letter(edge);
      const target = dawg.target(edge);
      if (rackCounts[letter] > 0) {
        rackCounts[letter]--;
        placedLetters[pos] = letter;
        placedBlanks[pos] = 0;
        buildPrefix(pos + 1, target, startPos);
        placedLetters[pos] = EMPTY;
        rackCounts[letter]++;
      }
      if (rackCounts[26] > 0) {
        rackCounts[26]--;
        placedLetters[pos] = letter;
        placedBlanks[pos] = 1;
        buildPrefix(pos + 1, target, startPos);
        placedLetters[pos] = EMPTY;
        placedBlanks[pos] = 0;
        rackCounts[26]++;
      }
      if (dawg.isLast(edge)) break;
    }
  };

  for (line = 0; line < SIZE; line++) {
    placedLetters.fill(EMPTY);
    placedBlanks.fill(0);

    for (let pos = 0; pos < SIZE; pos++) {
      const cell = at(line, pos);
      if (!anchors[cell]) continue;
      anchorPos = pos;

      if (pos > 0 && letters[at(line, pos - 1)] !== EMPTY) {
        // Prefixe impose par les jetons deja poses a gauche.
        let start = pos - 1;
        while (start > 0 && letters[at(line, start - 1)] !== EMPTY) start--;
        let node = ROOT;
        for (let k = start; k < pos; k++) {
          const edge = dawg.findEdge(node, letters[at(line, k)]);
          node = edge < 0 ? -1 : dawg.target(edge);
          if (node < 0) break;
        }
        if (node >= 0) extendRight(node, pos, start, false);
      } else {
        // Nombre de cases libres exploitables a gauche : on s'arrete a la case
        // occupee ou a l'ancre precedente, ce qui garantit qu'un coup n'est
        // engendre que depuis son ancre la plus a gauche (donc une seule fois).
        let limit = 0;
        let k = pos - 1;
        while (k >= 0 && letters[at(line, k)] === EMPTY && !anchors[at(line, k)] && limit < rackSize) {
          limit++;
          k--;
        }
        for (let start = pos - limit; start <= pos; start++) buildPrefix(start, ROOT, start);
      }
    }
  }
}

/** Applique un coup sur le plateau (mutation en place). */
export function applyMove(board, move) {
  for (const tile of move.tiles) {
    board.letters[tile.cell] = tile.letter;
    board.blanks[tile.cell] = tile.blank ? 1 : 0;
  }
  return board;
}

/**
 * Verifie un coup propose par le joueur : les jetons doivent etre alignes,
 * contigus, connectes au reste de la grille, et former des mots valides.
 * Renvoie { ok, score, words } ou { ok:false, error }.
 */
export function scorePlacement(dawg, board, placements) {
  if (!placements.length) return { ok: false, error: 'Aucun jeton pose.' };

  const { letters, blanks } = board;
  const rows = placements.map((tile) => Math.floor(tile.cell / SIZE));
  const cols = placements.map((tile) => tile.cell % SIZE);
  const sameRow = rows.every((row) => row === rows[0]);
  const sameCol = cols.every((col) => col === cols[0]);
  if (!sameRow && !sameCol) return { ok: false, error: 'Les jetons doivent etre alignes.' };

  // Grille temporaire incluant les jetons proposes.
  const temp = { letters: Int8Array.from(letters), blanks: Uint8Array.from(blanks) };
  for (const tile of placements) {
    if (letters[tile.cell] !== EMPTY) return { ok: false, error: 'Case deja occupee.' };
    temp.letters[tile.cell] = tile.letter;
    temp.blanks[tile.cell] = tile.blank ? 1 : 0;
  }

  const boardWasEmpty = letters.every((cell) => cell === EMPTY);
  const dir = sameRow && placements.length > 1 ? 0 : sameCol && placements.length > 1 ? 1 : 0;
  const at = dir === 0 ? horizontal : vertical;
  const line = dir === 0 ? rows[0] : cols[0];
  const positions = (dir === 0 ? cols : rows).slice().sort((a, b) => a - b);

  // Contiguite le long de la direction principale.
  for (let pos = positions[0]; pos <= positions[positions.length - 1]; pos++) {
    if (temp.letters[at(line, pos)] === EMPTY) return { ok: false, error: 'Le mot doit etre continu.' };
  }

  // Connexion au reste de la grille (ou passage par le centre au premier coup).
  if (boardWasEmpty) {
    if (!placements.some((tile) => tile.cell === CENTER)) {
      return { ok: false, error: 'Le premier mot doit passer par la case centrale.' };
    }
  } else {
    const connected = placements.some((tile) => {
      const row = Math.floor(tile.cell / SIZE);
      const col = tile.cell % SIZE;
      return (
        (row > 0 && letters[tile.cell - SIZE] !== EMPTY) ||
        (row < SIZE - 1 && letters[tile.cell + SIZE] !== EMPTY) ||
        (col > 0 && letters[tile.cell - 1] !== EMPTY) ||
        (col < SIZE - 1 && letters[tile.cell + 1] !== EMPTY)
      );
    });
    if (!connected) return { ok: false, error: 'Le mot doit toucher un jeton deja pose.' };
  }

  const placedCells = new Set(placements.map((tile) => tile.cell));
  const words = [];
  let total = 0;

  /** Score du mot passant par `cell` dans la direction `axis`. */
  const scoreWord = (cell, axis) => {
    const readAt = axis === 0 ? horizontal : vertical;
    const wordLine = axis === 0 ? Math.floor(cell / SIZE) : cell % SIZE;
    const start0 = axis === 0 ? cell % SIZE : Math.floor(cell / SIZE);

    let first = start0;
    while (first > 0 && temp.letters[readAt(wordLine, first - 1)] !== EMPTY) first--;
    let last = start0;
    while (last < SIZE - 1 && temp.letters[readAt(wordLine, last + 1)] !== EMPTY) last++;
    if (first === last) return null;

    let word = '';
    let sum = 0;
    let multiplier = 1;
    for (let pos = first; pos <= last; pos++) {
      const target = readAt(wordLine, pos);
      const letter = temp.letters[target];
      word += String.fromCharCode(65 + letter);
      let value = temp.blanks[target] ? 0 : LETTER_VALUES[letter];
      if (placedCells.has(target)) {
        const premium = PREMIUM[target];
        if (premium === 1) value *= 2;
        else if (premium === 2) value *= 3;
        else if (premium === 3) multiplier *= 2;
        else if (premium === 4) multiplier *= 3;
      }
      sum += value;
    }
    return { word, score: sum * multiplier };
  };

  const mainWord = scoreWord(placements[0].cell, dir);
  if (mainWord) {
    if (!dawg.has(mainWord.word)) return { ok: false, error: `${mainWord.word} n'est pas dans le dictionnaire.` };
    words.push(mainWord);
    total += mainWord.score;
  }

  for (const tile of placements) {
    const crossWord = scoreWord(tile.cell, 1 - dir);
    if (!crossWord) continue;
    if (!dawg.has(crossWord.word)) return { ok: false, error: `${crossWord.word} n'est pas dans le dictionnaire.` };
    words.push(crossWord);
    total += crossWord.score;
  }

  if (!words.length) return { ok: false, error: 'Il faut former un mot d\'au moins deux lettres.' };
  if (placements.length === RACK_SIZE) total += BINGO_BONUS;

  return { ok: true, score: total, words };
}

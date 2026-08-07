/**
 * Fabrication des problemes.
 *
 * On ne pose pas des mots au hasard : on joue reellement une partie contre
 * soi-meme (vrai sac, vrais tirages, coups plausibles) puis on s'arrete a un
 * moment choisi et on distribue un dernier chevalet. Le probleme consiste a
 * retrouver le coup qui rapporte le plus. La grille ressemble donc toujours a
 * une partie credible, et le tirage est coherent avec ce qui reste dans le sac.
 */

import { generateMoves, applyMove } from './movegen.js';
import {
  SIZE,
  EMPTY,
  BLANK,
  RACK_SIZE,
  VOWELS,
  newBag,
  shuffle,
  seededRandom,
  emptyBoard,
} from './rules.js';

export const LEVELS = {
  facile: {
    label: 'Facile',
    turns: [3, 6],
    score: [16, 38],
    tiles: [2, 4],
    minLength: 3,
    maxLength: 6,
    margin: 3,
    requireCommon: true,
    allowBlank: false,
  },
  moyen: {
    label: 'Moyen',
    turns: [5, 10],
    score: [30, 58],
    tiles: [2, 6],
    minLength: 3,
    maxLength: 8,
    margin: 2,
    requireCommon: true,
    allowBlank: false,
  },
  difficile: {
    label: 'Difficile',
    turns: [8, 14],
    score: [46, 999],
    tiles: [3, 7],
    maxLength: 12,
    margin: 1,
    requireCommon: false,
    allowBlank: true,
  },
  extreme: {
    label: 'Extreme',
    turns: [6, 13],
    score: [72, 999],
    tiles: [4, 7],
    maxLength: 15,
    margin: 0,
    requireCommon: false,
    allowBlank: true,
  },
};

const between = (value, [min, max]) => value >= min && value <= max;
const pick = (array, random) => array[Math.floor(random() * array.length)];
const randomInt = (min, max, random) => min + Math.floor(random() * (max - min + 1));

function draw(bag, rack, random) {
  while (rack.length < RACK_SIZE && bag.length) rack.push(bag.pop());
  return rack;
}

function vowelCount(rack) {
  return rack.filter((letter) => VOWELS.has(letter)).length;
}

/** Un tirage sans voyelle (ou tout en voyelles) n'a rien d'interessant. */
function acceptableRack(rack) {
  const vowels = vowelCount(rack);
  return rack.length === RACK_SIZE && vowels >= 2 && vowels <= 5;
}

function removeBlanks(rack, bag, random) {
  for (let i = 0; i < rack.length; i++) {
    if (rack[i] !== BLANK) continue;
    const index = bag.findIndex((letter) => letter !== BLANK);
    if (index < 0) return;
    rack[i] = bag[index];
    bag.splice(index, 1, BLANK);
  }
}

/**
 * Joue quelques coups plausibles. Le "bot" evite volontairement les coups
 * optimaux et les mots obscurs : la grille doit ressembler a une partie de
 * salon, pas a une demonstration de champion.
 */
function playOpening(dawg, common, turns, random) {
  const bag = shuffle(newBag(), random);
  const board = emptyBoard();
  const rack = [];

  for (let turn = 0; turn < turns; turn++) {
    draw(bag, rack, random);
    if (rack.length < 2) break;

    const moves = generateMoves(dawg, board, rack);
    if (!moves.length) {
      // Tirage bloque : on le renvoie au sac et on repioche.
      bag.push(...rack.splice(0, rack.length));
      shuffle(bag, random);
      continue;
    }

    const natural = moves.filter(
      (move) =>
        move.word.length <= 8 &&
        move.score >= 8 &&
        move.score <= 42 &&
        move.tiles.length <= 4 &&
        common.has(move.word)
    );
    const pool = natural.length ? natural : moves.slice(0, Math.max(1, Math.ceil(moves.length * 0.4)));
    const move = pick(pool, random);

    applyMove(board, move);
    for (const tile of move.tiles) {
      const index = rack.indexOf(tile.blank ? BLANK : tile.letter);
      if (index >= 0) rack.splice(index, 1);
    }
  }

  return { board, bag, rack };
}

function describe(dawg, common, moves) {
  const best = moves[0];
  const runnerUp = moves.find((move) => move.score < best.score);
  return {
    best,
    margin: runnerUp ? best.score - runnerUp.score : best.score,
    isCommon: common.has(best.word),
  };
}

function fits(level, moves, analysis) {
  const { best, margin, isCommon } = analysis;
  const spec = LEVELS[level];
  if (moves.length < 25) return false;
  if (best.tiles.length === RACK_SIZE && level === 'extreme') return true; // un scrabble suffit
  if (!between(best.score, spec.score)) return false;
  if (!between(best.tiles.length, spec.tiles)) return false;
  if (best.word.length > spec.maxLength) return false;
  if (spec.minLength && best.word.length < spec.minLength) return false;
  if (margin < spec.margin) return false;
  if (spec.requireCommon && !isCommon) return false;
  return true;
}

/**
 * Renvoie un probleme complet, ou null si la calibration n'aboutit pas.
 * `seed` rend la generation reproductible (utile pour rejouer une grille).
 */
export function generatePuzzle(dawg, common, level, seed) {
  const spec = LEVELS[level];
  if (!spec) throw new Error(`Niveau inconnu : ${level}`);
  const random = seededRandom(seed);

  for (let boardAttempt = 0; boardAttempt < 40; boardAttempt++) {
    const turns = randomInt(spec.turns[0], spec.turns[1], random);
    const { board, bag } = playOpening(dawg, common, turns, random);
    if (board.letters.every((cell) => cell === EMPTY)) continue;

    for (let rackAttempt = 0; rackAttempt < 14; rackAttempt++) {
      const pool = bag.slice();
      shuffle(pool, random);
      const rack = pool.splice(0, RACK_SIZE);
      if (!spec.allowBlank) removeBlanks(rack, pool, random);
      if (!acceptableRack(rack)) continue;

      const moves = generateMoves(dawg, board, rack);
      if (!moves.length) continue;
      const analysis = describe(dawg, common, moves);
      if (!fits(level, moves, analysis)) continue;

      return buildPuzzle(level, seed, board, rack, moves, analysis, common);
    }
  }
  return null;
}

function buildPuzzle(level, seed, board, rack, moves, analysis, common) {
  const { best } = analysis;

  // Les meilleurs coups a scores distincts : sert au retour "tu es a 8 points".
  const podium = [];
  for (const move of moves) {
    if (podium.length >= 5) break;
    if (podium.some((entry) => entry.score === move.score)) continue;
    podium.push({ word: move.word, score: move.score, tiles: move.tiles.length });
  }

  return {
    level,
    seed,
    board: {
      letters: Array.from(board.letters),
      blanks: Array.from(board.blanks),
    },
    rack: Array.from(rack),
    target: best.score,
    solution: {
      word: best.word,
      score: best.score,
      dir: best.dir,
      start: best.start,
      tiles: best.tiles,
      isCommon: common.has(best.word),
    },
    podium,
    moveCount: moves.length,
    margin: analysis.margin,
  };
}

/** Aides progressives, calculees a partir de la solution. */
export function buildHints(puzzle) {
  const { solution, target } = puzzle;
  const row = Math.floor(solution.start / SIZE) + 1;
  const col = String.fromCharCode(65 + (solution.start % SIZE));
  return [
    `Le meilleur coup rapporte ${target} points et pose ${solution.tiles.length} jetons.`,
    `Le mot se joue ${solution.dir === 0 ? 'horizontalement' : 'verticalement'} et fait ${solution.word.length} lettres.`,
    `Il commence case ${col}${row}.`,
    `Sa premiere lettre est un ${solution.word[0]}.`,
  ];
}

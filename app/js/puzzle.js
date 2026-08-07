/**
 * Fabrication des problemes.
 *
 * On ne pose pas des mots au hasard : on joue reellement une partie contre
 * soi-meme (vrai sac, vrais tirages, coups plausibles) puis on s'arrete a un
 * moment choisi et on distribue un dernier chevalet. Le probleme consiste a
 * retrouver le coup qui rapporte le plus. La grille ressemble donc toujours a
 * une partie credible, et le tirage est coherent avec ce qui reste dans le sac.
 */

import { generateMoves, applyMove, scorePlacement } from './movegen.js';
import {
  SIZE,
  EMPTY,
  BLANK,
  RACK_SIZE,
  VOWELS,
  PREMIUM,
  LETTER_VALUES,
  newBag,
  shuffle,
  seededRandom,
  emptyBoard,
} from './rules.js';

export const LEVELS = {
  // `turns` : nombre de coups joues avant de rendre la main. Les fourchettes
  // sont larges a dessein — c'est ce qui fait qu'une grille arrive presque vide
  // ou deja bien remplie, au lieu de toujours se ressembler.
  facile: {
    label: 'Facile',
    turns: [2, 9],
    score: [16, 38],
    tiles: [2, 4],
    minLength: 3,
    maxLength: 7,
    margin: 3,
    requireCommon: true,
    allowBlank: false,
  },
  moyen: {
    label: 'Moyen',
    turns: [4, 13],
    score: [30, 58],
    tiles: [2, 6],
    minLength: 3,
    maxLength: 9,
    margin: 2,
    requireCommon: true,
    allowBlank: false,
  },
  difficile: {
    label: 'Difficile',
    turns: [6, 18],
    score: [46, 999],
    tiles: [3, 7],
    maxLength: 15,
    margin: 1,
    requireCommon: false,
    allowBlank: true,
  },
  extreme: {
    label: 'Extreme',
    turns: [5, 16],
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

      return buildPuzzle(level, seed, board, rack, moves, analysis, common, dawg);
    }
  }
  return null;
}

function buildPuzzle(level, seed, board, rack, moves, analysis, common, dict) {
  const { best } = analysis;
  // Nombre de mots formes d'un coup : sert d'indice, et n'est pas connu du
  // generateur, qui ne compte que le score.
  const verdict = scorePlacement(dict, board, best.tiles);

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
      words: verdict.ok ? verdict.words.length : 1,
    },
    podium,
    moveCount: moves.length,
    margin: analysis.margin,
  };
}

const CASE_LABEL = ['', 'lettre compte double', 'lettre compte triple', 'mot compte double', 'mot compte triple'];

const cellName = (cell) => `${String.fromCharCode(65 + (cell % SIZE))}${Math.floor(cell / SIZE) + 1}`;

/**
 * Reservoir d'indices, ranges du plus vague au plus precis.
 *
 * Quatre paliers, un indice tire dans chacun : les indices restent progressifs,
 * mais changent d'un probleme a l'autre. Une liste fixe se retenait par coeur au
 * bout de quelques parties et ne renseignait plus sur rien.
 *
 * Chaque entree peut renvoyer null quand elle ne s'applique pas (pas de case
 * speciale utilisee, aucune lettre inutilisee...) ; on tire alors ailleurs dans
 * le meme palier.
 */
const HINT_POOL = [
  // --- palier 1 : de quoi il s'agit ---------------------------------------
  { tier: 0, make: (p) => `Le meilleur coup pose ${p.solution.tiles.length} jeton${p.solution.tiles.length > 1 ? 's' : ''}.` },
  { tier: 0, make: (p) => (p.solution.isCommon ? "C'est un mot que tout le monde connait." : "C'est un mot rare : ne cherchez pas du cote du langage courant.") },
  {
    tier: 0,
    make: (p) => {
      const restantes = p.rack.length - p.solution.tiles.length;
      return restantes > 0 ? `${restantes} lettre${restantes > 1 ? 's' : ''} du tirage ne sert${restantes > 1 ? 'ent' : ''} pas.` : 'Les sept lettres du tirage y passent.';
    },
  },
  { tier: 0, make: (p) => (p.solution.words > 1 ? `Le coup forme ${p.solution.words} mots d'un coup.` : "Le coup ne forme qu'un seul mot.") },

  // --- palier 2 : sa forme -------------------------------------------------
  { tier: 1, make: (p) => `Le meilleur coup rapporte ${p.target} points.` },
  { tier: 1, make: (p) => `Le mot se joue ${p.solution.dir === 0 ? 'horizontalement' : 'verticalement'}.` },
  { tier: 1, make: (p) => `Le mot fait ${p.solution.word.length} lettres.` },
  {
    tier: 1,
    make: (p) => {
      const posees = p.solution.tiles.length;
      const empruntees = p.solution.word.length - posees;
      return empruntees > 0 ? `Le mot s'appuie sur ${empruntees} lettre${empruntees > 1 ? 's' : ''} deja sur la grille.` : null;
    },
  },

  // --- palier 3 : ou il se trouve -----------------------------------------
  { tier: 2, make: (p) => `Il commence case ${cellName(p.solution.start)}.` },
  {
    tier: 2,
    make: (p) => {
      const premium = p.solution.tiles.map((t) => PREMIUM[t.cell]).filter(Boolean).sort((a, b) => b - a)[0];
      return premium ? `Le coup passe par une case ${CASE_LABEL[premium]}.` : null;
    },
  },
  {
    tier: 2,
    make: (p) =>
      p.solution.dir === 0
        ? `Tout se joue sur la rangee ${Math.floor(p.solution.start / SIZE) + 1}.`
        : `Tout se joue sur la colonne ${String.fromCharCode(65 + (p.solution.start % SIZE))}.`,
  },

  // --- palier 4 : ses lettres ---------------------------------------------
  { tier: 3, make: (p) => `Sa premiere lettre est un ${p.solution.word[0]}.` },
  { tier: 3, make: (p) => `Sa derniere lettre est un ${p.solution.word[p.solution.word.length - 1]}.` },
  {
    tier: 3,
    make: (p) => {
      const chere = p.solution.tiles.filter((t) => !t.blank).sort((a, b) => LETTER_VALUES[b.letter] - LETTER_VALUES[a.letter])[0];
      return chere && LETTER_VALUES[chere.letter] >= 3
        ? `Le ${String.fromCharCode(65 + chere.letter)} de votre tirage est utilise.`
        : null;
    },
  },
];

/** Quatre indices tires du reservoir, un par palier, du plus vague au plus precis. */
export function buildHints(puzzle) {
  const random = seededRandom((puzzle.seed ^ 0x9e3779b9) >>> 0);
  const hints = [];

  for (let tier = 0; tier < 4; tier++) {
    const candidats = shuffle(
      HINT_POOL.filter((entry) => entry.tier === tier),
      random
    );
    for (const candidat of candidats) {
      const texte = candidat.make(puzzle);
      if (texte) {
        hints.push(texte);
        break;
      }
    }
  }
  return hints;
}

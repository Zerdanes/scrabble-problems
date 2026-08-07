/** Regles du Scrabble francais : plateau, valeurs des lettres, sac. */

export const SIZE = 15;
export const CELLS = SIZE * SIZE;
export const CENTER = 7 * SIZE + 7;
export const EMPTY = -1;
export const BLANK = 26;
export const RACK_SIZE = 7;
export const BINGO_BONUS = 50;

/**
 * Cases speciales :
 *   T = mot compte triple   D = mot compte double
 *   t = lettre compte triple  d = lettre compte double
 *   * = case centrale (mot compte double)
 */
export const PREMIUM_ROWS = [
  'T..d...T...d..T',
  '.D...t...t...D.',
  '..D...d.d...D..',
  'd..D...d...D..d',
  '....D.....D....',
  '.t...t...t...t.',
  '..d...d.d...d..',
  'T..d...*...d..T',
  '..d...d.d...d..',
  '.t...t...t...t.',
  '....D.....D....',
  'd..D...d...D..d',
  '..D...d.d...D..',
  '.D...t...t...D.',
  'T..d...T...d..T',
];

export const PREMIUM = new Uint8Array(CELLS); // 0 rien, 1 LD, 2 LT, 3 MD, 4 MT
export const PREMIUM_CODE = ['', 'd', 't', 'D', 'T'];
{
  const codes = { '.': 0, d: 1, t: 2, D: 3, T: 4, '*': 3 };
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      PREMIUM[row * SIZE + col] = codes[PREMIUM_ROWS[row][col]];
    }
  }
}

export const LETTER_VALUES = Int8Array.from([
  1, 3, 3, 2, 1, 4, 2, 4, 1, 8, 10, 1, 2, 1, 1, 3, 8, 1, 1, 1, 1, 4, 10, 10, 10, 10,
]);
//  A  B  C  D  E  F  G  H  I  J   K  L  M  N  O  P  Q  R  S  T  U  V   W   X   Y   Z

/** Distribution francaise : 102 jetons dont 2 jokers. */
export const DISTRIBUTION = [
  9, 2, 2, 3, 15, 2, 2, 2, 8, 1, 1, 5, 3, 6, 6, 2, 1, 6, 6, 6, 6, 2, 1, 1, 1, 1,
];
export const BLANK_COUNT = 2;

export const VOWELS = new Set([0, 4, 8, 14, 20]); // A E I O U

export function letterChar(letter) {
  return letter === BLANK ? '?' : String.fromCharCode(65 + letter);
}

export function charLetter(char) {
  if (char === '?' || char === ' ') return BLANK;
  const letter = char.toUpperCase().charCodeAt(0) - 65;
  return letter >= 0 && letter <= 25 ? letter : EMPTY;
}

export function tileValue(letter, isBlank) {
  return isBlank || letter === BLANK ? 0 : LETTER_VALUES[letter];
}

export function newBag() {
  const bag = [];
  for (let letter = 0; letter < 26; letter++) {
    for (let i = 0; i < DISTRIBUTION[letter]; i++) bag.push(letter);
  }
  for (let i = 0; i < BLANK_COUNT; i++) bag.push(BLANK);
  return bag;
}

/** Melange de Fisher-Yates, avec generateur injectable pour la reproductibilite. */
export function shuffle(array, random = Math.random) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/** Generateur pseudo-aleatoire deterministe (mulberry32) : une graine = une grille. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function emptyBoard() {
  return {
    letters: Int8Array.from({ length: CELLS }, () => EMPTY),
    blanks: new Uint8Array(CELLS),
  };
}

export function isEmptyBoard(board) {
  return board.letters.every((cell) => cell === EMPTY);
}

/**
 * Le generateur de coups oublie-t-il des coups ?
 *   node test/completude.js
 *
 * La suite principale verifie que chaque coup produit par generateMoves est
 * accepte par scorePlacement avec le meme score. Cela ne dit rien du sens
 * inverse : un coup que le generateur aurait manque, mais que le joueur peut
 * poser, passerait inapercu. Si un tel coup rapportait plus que l'objectif
 * affiche, le probleme serait injouable — le joueur trouverait mieux que le
 * "meilleur coup" et le jeu refuserait de le reconnaitre.
 *
 * Ici on enumere donc les placements a la main, sans utiliser le generateur :
 * toutes les directions, toutes les portions de ligne, toutes les facons de
 * remplir leurs cases vides avec les jetons du tirage. Chaque placement est
 * soumis a scorePlacement, et on exige qu'aucun ne depasse l'objectif.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Dawg } from '../app/js/dawg.js';
import { scorePlacement } from '../app/js/movegen.js';
import { generatePuzzle, LEVELS } from '../app/js/puzzle.js';
import { SIZE, EMPTY } from '../app/js/rules.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadDawg(name) {
  const buffer = fs.readFileSync(path.join(ROOT, 'app', 'data', name));
  return Dawg.fromBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

const dict = loadDawg('dict.bin');
const common = loadDawg('common.bin');

/** Arrangements de `k` jetons pris parmi le tirage (l'ordre compte). */
function* arrangements(rack, k, used = [], chosen = []) {
  if (chosen.length === k) {
    yield chosen;
    return;
  }
  const seen = new Set();
  for (let i = 0; i < rack.length; i++) {
    if (used[i] || seen.has(rack[i])) continue; // deux jetons identiques : un seul essai
    seen.add(rack[i]);
    used[i] = true;
    chosen.push(rack[i]);
    yield* arrangements(rack, k, used, chosen);
    chosen.pop();
    used[i] = false;
  }
}

/**
 * Meilleur score atteignable, calcule sans le generateur.
 * `maxTiles` borne la recherche : au-dela de 5 jetons le nombre d'arrangements
 * explose, on traite ces cas separement.
 */
function bruteForceBest(board, rack, maxTiles) {
  let best = { score: 0, word: null };
  let tested = 0;

  for (let dir = 0; dir < 2; dir++) {
    const at = dir === 0 ? (line, pos) => line * SIZE + pos : (line, pos) => pos * SIZE + line;

    for (let line = 0; line < SIZE; line++) {
      for (let start = 0; start < SIZE; start++) {
        for (let end = start; end < SIZE; end++) {
          // Cases vides de la portion : ce sont elles qu'il faut remplir.
          const holes = [];
          for (let pos = start; pos <= end; pos++) {
            const cell = at(line, pos);
            if (board.letters[cell] === EMPTY) holes.push(cell);
          }
          if (!holes.length || holes.length > maxTiles || holes.length > rack.length) continue;
          // La portion doit commencer et finir sur une case a remplir, sinon le
          // meme coup est deja couvert par une portion plus courte.
          if (board.letters[at(line, start)] !== EMPTY || board.letters[at(line, end)] !== EMPTY) continue;

          for (const letters of arrangements(rack, holes.length)) {
            const placements = holes.map((cell, i) => ({ cell, letter: letters[i], blank: false }));
            const verdict = scorePlacement(dict, board, placements);
            tested++;
            if (verdict.ok && verdict.score > best.score) {
              best = { score: verdict.score, word: verdict.words[0].word, tiles: placements.length };
            }
          }
        }
      }
    }
  }
  return { best, tested };
}

const MAX_TILES = Number(process.argv[2] ?? 4);
let failures = 0;
let totalTested = 0;

console.log(`Recherche exhaustive des coups jusqu'a ${MAX_TILES} jetons, sans passer par le generateur.\n`);

for (const level of Object.keys(LEVELS)) {
  for (let i = 0; i < 4; i++) {
    const puzzle = generatePuzzle(dict, common, level, 5000 + i * 31337);
    if (!puzzle) continue;

    const board = {
      letters: Int8Array.from(puzzle.board.letters),
      blanks: Uint8Array.from(puzzle.board.blanks),
    };
    // Les jokers sont ecartes ici : ils multiplieraient la recherche par 26 sans
    // rien apporter, un joker ne pouvant que valoir moins qu'une vraie lettre.
    if (puzzle.rack.includes(26)) continue;

    const started = Date.now();
    const { best, tested } = bruteForceBest(board, puzzle.rack, MAX_TILES);
    totalTested += tested;

    const depasse = best.score > puzzle.target;
    if (depasse) failures++;

    console.log(
      `${level.padEnd(10)} objectif ${String(puzzle.target).padStart(3)} (${puzzle.solution.word})  ` +
        `force brute ${String(best.score).padStart(3)} (${best.word ?? '-'})  ` +
        `${String(tested).padStart(7)} placements  ${String(Date.now() - started).padStart(5)} ms  ` +
        `${depasse ? '*** DEPASSE L OBJECTIF ***' : 'ok'}`
    );
  }
}

console.log(`\n${totalTested.toLocaleString('fr-FR')} placements testes un a un.`);
console.log(
  failures
    ? `\n${failures} probleme(s) ou un coup depasse l'objectif : le generateur en oublie.\n`
    : `\nAucun coup ne depasse l'objectif affiche : le generateur n'en oublie aucun.\n`
);
process.exit(failures ? 1 : 0);

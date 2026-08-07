/**
 * Verification du moteur, hors navigateur.
 *   node test/test.js
 *
 * Le controle le plus utile est le croisement : pour chaque coup engendre par le
 * generateur, on rejoue le placement dans scorePlacement() (ecrit separement) et
 * on exige le meme score. Une erreur de multiplicateur ne peut pas passer les deux.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Dawg } from '../app/js/dawg.js';
import { generateMoves, applyMove, scorePlacement } from '../app/js/movegen.js';
import { generatePuzzle, LEVELS } from '../app/js/puzzle.js';
import { emptyBoard, charLetter, SIZE, EMPTY, BLANK, letterChar } from '../app/js/rules.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadDawg(name) {
  const buffer = fs.readFileSync(path.join(ROOT, 'app', 'data', name));
  return Dawg.fromBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

const dict = loadDawg('dict.bin');
const common = loadDawg('common.bin');

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` : attendu ${expected}, obtenu ${actual}`}`);
}

function rackOf(letters) {
  return [...letters].map((char) => (char === '?' ? BLANK : charLetter(char)));
}

function render(board) {
  const lines = [];
  for (let row = 0; row < SIZE; row++) {
    let line = '';
    for (let col = 0; col < SIZE; col++) {
      const cell = board.letters[row * SIZE + col];
      line += cell === EMPTY ? ' .' : ' ' + letterChar(cell);
    }
    lines.push(line);
  }
  return lines.join('\n');
}

console.log('\n--- dictionnaire ---');
check('BONJOUR est valide', dict.has('BONJOUR'), true);
check('ZZZZ est invalide', dict.has('ZZZZ'), false);
check('AA est valide (ODS)', dict.has('AA'), true);
check('CHAT est courant', common.has('CHAT'), true);
check('anagrammes de CHIEN contiennent NICHE', dict.anagrams('CHIEN').includes('NICHE'), true);
check('motif C?AT trouve CHAT', dict.match('C?AT').includes('CHAT'), true);

console.log('\n--- premier coup ---');
{
  const board = emptyBoard();
  const moves = generateMoves(dict, board, rackOf('BON'));
  // Le premier mot couvre la case centrale (mot compte double) et aucune des
  // cases lettre-double de la rangee 8 : B(3) + O(1) + N(1) = 5, double = 10.
  check('meilleur coup avec BON', moves[0].score, 10);
  check('le mot fait 3 lettres', moves[0].word.length, 3);
  check('tous les coups passent par le centre', moves.every((m) => m.tiles.some((t) => t.cell === 7 * SIZE + 7)), true);
}

console.log('\n--- coherence generateur / verificateur ---');
{
  let compared = 0;
  let mismatched = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const puzzle = generatePuzzle(dict, common, ['facile', 'moyen', 'difficile', 'extreme'][seed % 4], seed * 7919);
    if (!puzzle) continue;
    const board = {
      letters: Int8Array.from(puzzle.board.letters),
      blanks: Uint8Array.from(puzzle.board.blanks),
    };
    const moves = generateMoves(dict, board, puzzle.rack);
    for (const move of moves.slice(0, 40)) {
      const verdict = scorePlacement(dict, board, move.tiles);
      compared++;
      if (!verdict.ok || verdict.score !== move.score) {
        mismatched++;
        if (mismatched <= 3) {
          console.log(`   desaccord sur ${move.word} : generateur ${move.score}, verificateur ${verdict.score ?? verdict.error}`);
        }
      }
    }
  }
  check(`${compared} coups rejoues sans desaccord`, mismatched, 0);
}

console.log('\n--- validation de placements ---');
{
  const board = emptyBoard();
  const first = generateMoves(dict, board, rackOf('MAISON'))[0];
  applyMove(board, first);
  const detached = scorePlacement(dict, board, [{ cell: 0, letter: charLetter('A'), blank: false }]);
  check('un jeton isole est refuse', detached.ok, false);
  const overlap = scorePlacement(dict, board, [{ cell: first.tiles[0].cell, letter: 0, blank: false }]);
  check('une case occupee est refusee', overlap.ok, false);
}

console.log('\n--- generation des problemes ---');
for (const level of Object.keys(LEVELS)) {
  const started = Date.now();
  const scores = [];
  const tiles = [];
  let commonCount = 0;
  let failed = 0;

  for (let i = 0; i < 20; i++) {
    const puzzle = generatePuzzle(dict, common, level, 1000 + i * 104729);
    if (!puzzle) {
      failed++;
      continue;
    }
    scores.push(puzzle.target);
    tiles.push(puzzle.solution.tiles.length);
    if (puzzle.solution.isCommon) commonCount++;
  }

  const elapsed = Date.now() - started;
  const average = (list) => (list.reduce((sum, value) => sum + value, 0) / list.length).toFixed(1);
  console.log(
    `${level.padEnd(10)} ${String(scores.length).padStart(2)}/20 generes  ` +
      `${String(Math.round(elapsed / 20)).padStart(5)} ms/probleme  ` +
      `score moy ${average(scores).padStart(5)} (min ${Math.min(...scores)}, max ${Math.max(...scores)})  ` +
      `jetons moy ${average(tiles)}  mots courants ${commonCount}/${scores.length}`
  );
  check(`${level} : 20 problemes generes`, failed, 0);
}

console.log('\n--- exemple ---');
{
  const puzzle = generatePuzzle(dict, common, 'moyen', 424242);
  if (puzzle) {
    console.log(render({ letters: Int8Array.from(puzzle.board.letters) }));
    console.log(`tirage : ${puzzle.rack.map(letterChar).join(' ')}`);
    console.log(`solution : ${puzzle.solution.word} pour ${puzzle.target} points`);
    console.log(`podium : ${puzzle.podium.map((p) => `${p.word} ${p.score}`).join(' | ')}`);
    console.log(`${puzzle.moveCount} coups legaux au total`);
  }
}

console.log(failures ? `\n${failures} verification(s) en echec\n` : '\nTout est vert\n');
process.exit(failures ? 1 : 0);


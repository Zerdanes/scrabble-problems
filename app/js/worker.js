/**
 * Le dictionnaire et le solveur tournent dans un worker : la generation d'un
 * probleme explore des milliers de coups et bloquerait sinon l'affichage.
 */

import { Dawg } from './dawg.js';
import { scorePlacement } from './movegen.js';
import { generatePuzzle, buildHints } from './puzzle.js';

let dict = null;
let common = null;

const boardFrom = (plain) => ({
  letters: Int8Array.from(plain.letters),
  blanks: Uint8Array.from(plain.blanks),
});

const handlers = {
  async init() {
    [dict, common] = await Promise.all([
      Dawg.load(new URL('../data/dict.bin', import.meta.url)),
      Dawg.load(new URL('../data/common.bin', import.meta.url)),
    ]);
    return { ready: true, words: dict.wordCount, common: common.wordCount };
  },

  /** Plusieurs graines d'affilee : la calibration d'un niveau peut echouer. */
  puzzle({ level }) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const seed = (Math.random() * 0xffffffff) >>> 0;
      const puzzle = generatePuzzle(dict, common, level, seed);
      if (puzzle) {
        puzzle.hints = buildHints(puzzle);
        return puzzle;
      }
    }
    throw new Error("Impossible de composer un probleme a ce niveau, reessaie.");
  },

  check({ board, placements }) {
    return scorePlacement(dict, boardFrom(board), placements);
  },

  lookup({ query }) {
    const cleaned = query.toUpperCase().replace(/[^A-Z?*]/g, '');
    if (!cleaned) return { query: cleaned, valid: null, anagrams: [], matches: [] };

    const isPattern = cleaned.includes('?') || cleaned.includes('*');
    const result = {
      query: cleaned,
      valid: isPattern ? null : dict.has(cleaned),
      common: isPattern ? null : common.has(cleaned),
      anagrams: [],
      matches: [],
    };

    if (isPattern) {
      result.matches = [...new Set(dict.match(cleaned, 300))].sort(
        (a, b) => a.length - b.length || a.localeCompare(b)
      );
    }
    // Les anagrammes servent aussi de "que faire avec ces lettres" : on les donne
    // toujours, y compris quand le mot tape est valide.
    result.anagrams = dict
      .anagrams(cleaned.replace(/\*/g, ''), { limit: 400, minLength: 2 })
      .filter((word) => word !== cleaned);
    return result;
  },
};

self.onmessage = async ({ data }) => {
  const { id, type, payload } = data;
  try {
    const handler = handlers[type];
    if (!handler) throw new Error(`Action inconnue : ${type}`);
    self.postMessage({ id, result: await handler(payload ?? {}) });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};

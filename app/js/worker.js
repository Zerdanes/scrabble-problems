/**
 * Le dictionnaire et le solveur tournent dans un worker : la generation d'un
 * probleme explore des milliers de coups et bloquerait sinon l'affichage.
 */

import { Dawg } from './dawg.js';
import { scorePlacement, allowedLetters } from './movegen.js';
import { generatePuzzle, buildHints } from './puzzle.js';

let dict = null;
let common = null;

/**
 * Plafonds de recherche du dictionnaire. Ils protegent l'affichage : un motif
 * comme `*` sortirait sinon des centaines de milliers de mots. L'interface a
 * besoin de les connaitre pour dire honnetement qu'une liste est tronquee.
 */
const CAPS = { matches: 300, anagrams: 400 };

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

  /**
   * Lettres acceptables sur une case, dans les deux sens d'ecriture.
   *
   * On renvoie toutes les lettres de l'alphabet qui conviennent, pas seulement
   * celles du tirage : la question posee est « qu'est-ce qui peut tenir ici »,
   * et la reponse ne depend pas des jetons en main. Celles que le joueur possede
   * sont simplement signalees.
   *
   * Les deux sens sont donnes ensemble : ecrire horizontalement ou verticalement
   * a travers cette case ne subit pas du tout la meme contrainte, et n'en montrer
   * qu'un revenait a cacher la moitie de la reponse.
   */
  letters({ board, cell, rack }) {
    const plateau = boardFrom(board);
    const enMain = new Set(rack.filter((letter) => letter !== 26));
    const decrire = (dir) => {
      const result = allowedLetters(dict, plateau, cell, dir);
      return { ...result, inRack: (result.letters ?? []).filter((letter) => enMain.has(letter)) };
    };
    return { horizontal: decrire(0), vertical: decrire(1), joker: rack.includes(26) };
  },

  lookup({ query, length = null }) {
    const cleaned = query.toUpperCase().replace(/[^A-Z?*]/g, '');
    // La longueur demandee descend jusqu'au parcours du dictionnaire : filtrer
    // apres coup ne montrerait que les mots de la bonne longueur parmi les 300
    // premiers trouves, au lieu des 300 premiers de la bonne longueur.
    const size = Number.isInteger(length) && length >= 2 && length <= 15 ? length : null;
    const empty = { query: cleaned, length: size, valid: null, anagrams: [], matches: [], caps: CAPS };
    if (!cleaned) return empty;

    const isPattern = cleaned.includes('?') || cleaned.includes('*');
    const result = {
      ...empty,
      valid: isPattern ? null : dict.has(cleaned),
      common: isPattern ? null : common.has(cleaned),
    };

    if (isPattern) {
      // Le plafond atteint signale une liste tronquee : c'est dit a l'ecran,
      // sinon on croirait avoir sous les yeux tous les mots possibles.
      const found = dict.match(cleaned, CAPS.matches, { length: size });
      result.matchesCapped = found.length >= CAPS.matches;
      result.matches = [...new Set(found)].sort((a, b) => a.length - b.length || a.localeCompare(b));
    }
    // Les anagrammes servent aussi de "que faire avec ces lettres" : on les donne
    // toujours, y compris quand le mot tape est valide.
    const composables = dict.anagrams(cleaned.replace(/\*/g, ''), {
      limit: CAPS.anagrams,
      minLength: 2,
      length: size,
    });
    result.anagramsCapped = composables.length >= CAPS.anagrams;
    result.anagrams = composables.filter((word) => word !== cleaned);
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

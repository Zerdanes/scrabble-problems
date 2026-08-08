/**
 * Lecture du dictionnaire binaire produit par build/build-dict.js.
 *
 * Un "noeud" est l'index de son premier arc dans le tableau. La racine vaut 0,
 * donc un arc dont la cible vaut 0 est une feuille (aucune suite possible).
 */

const LETTER_MASK = 0x1f;
const IS_WORD = 1 << 5;
const IS_LAST = 1 << 6;
const TARGET_SHIFT = 7;

export const A_CODE = 65;
export const ROOT = 0;

export class Dawg {
  constructor(edges, wordCount = 0) {
    this.edges = edges;
    this.wordCount = wordCount;
  }

  static async load(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Dictionnaire introuvable : ${url}`);
    return Dawg.fromBuffer(await response.arrayBuffer());
  }

  static fromBuffer(buffer) {
    const header = new Uint32Array(buffer, 0, 3);
    if (header[0] !== 0x47574144) throw new Error('Fichier dictionnaire invalide');
    return new Dawg(new Uint32Array(buffer, 12, header[1]), header[2]);
  }

  letter(edge) {
    return this.edges[edge] & LETTER_MASK;
  }

  isWord(edge) {
    return (this.edges[edge] & IS_WORD) !== 0;
  }

  isLast(edge) {
    return (this.edges[edge] & IS_LAST) !== 0;
  }

  /** Noeud d'arrivee de l'arc, ou -1 s'il n'y a pas de suite. */
  target(edge) {
    const node = this.edges[edge] >>> TARGET_SHIFT;
    return node === 0 ? -1 : node;
  }

  /** Index de l'arc partant de `node` pour cette lettre (0-25), ou -1. */
  findEdge(node, letter) {
    if (node < 0) return -1;
    for (let edge = node; ; edge++) {
      const cell = this.edges[edge];
      if ((cell & LETTER_MASK) === letter) return edge;
      if (cell & IS_LAST) return -1;
    }
  }

  /** Dernier arc (inclus) de la liste d'arcs du noeud. */
  lastEdge(node) {
    let edge = node;
    while (!(this.edges[edge] & IS_LAST)) edge++;
    return edge;
  }

  has(word) {
    if (word.length < 2) return false;
    let node = ROOT;
    for (let i = 0; i < word.length; i++) {
      const letter = word.charCodeAt(i) - A_CODE;
      if (letter < 0 || letter > 25) return false;
      const edge = this.findEdge(node, letter);
      if (edge < 0) return false;
      if (i === word.length - 1) return this.isWord(edge);
      node = this.target(edge);
      if (node < 0) return false;
    }
    return false;
  }

  /**
   * Mots correspondant a un motif : lettres litterales, `?` pour une lettre
   * quelconque, `*` pour une suite quelconque (eventuellement vide).
   *
   * `length` ne garde que les mots de cette longueur exacte. Le tri se fait
   * pendant la descente et non sur le resultat : `limit` serait sinon atteint par
   * des mots que l'on jette ensuite, et les mots de la bonne longueur qui suivent
   * ne seraient jamais vus.
   */
  match(pattern, limit = 200, { length = null } = {}) {
    const results = [];
    const chars = [...pattern.toUpperCase()];

    // Lettres qu'il reste obligatoirement a poser depuis chaque position du
    // motif : au-dela de la longueur demandee, la branche ne peut plus aboutir.
    const need = new Array(chars.length + 1).fill(0);
    for (let i = chars.length - 1; i >= 0; i--) need[i] = need[i + 1] + (chars[i] === '*' ? 0 : 1);

    const keep = (word) => word.length >= 2 && (length == null || word.length === length);

    const walk = (node, index, prefix) => {
      if (results.length >= limit) return;
      if (index === chars.length) return;
      if (length != null && prefix.length + need[index] > length) return;

      const token = chars[index];
      const last = index === chars.length - 1;

      const consume = (edge, letter) => {
        const word = prefix + String.fromCharCode(A_CODE + letter);
        if (last && this.isWord(edge) && keep(word)) results.push(word);
        if (!last) walk(this.target(edge), index + 1, word);
      };

      if (token === '*') {
        // Soit on ne consomme rien, soit on avale une lettre et on reste sur `*`.
        if (last) {
          this.collect(node, prefix, results, limit, length);
        } else {
          walk(node, index + 1, prefix);
          for (let edge = node; node >= 0; edge++) {
            const next = this.target(edge);
            if (next >= 0) walk(next, index, prefix + String.fromCharCode(A_CODE + this.letter(edge)));
            if (this.isLast(edge)) break;
          }
        }
        return;
      }

      if (token === '?' || token === '.') {
        for (let edge = node; node >= 0; edge++) {
          consume(edge, this.letter(edge));
          if (this.isLast(edge)) break;
        }
        return;
      }

      const letter = token.charCodeAt(0) - A_CODE;
      if (letter < 0 || letter > 25) return;
      const edge = this.findEdge(node, letter);
      if (edge >= 0) consume(edge, letter);
    };

    if (chars.length) walk(ROOT, 0, '');
    return results;
  }

  /** Tous les mots atteignables depuis `node`, prefixes par `prefix`. */
  collect(node, prefix, results, limit, length = null) {
    if (node < 0 || results.length >= limit) return;
    if (length != null && prefix.length >= length) return; // deja trop long
    for (let edge = node; ; edge++) {
      const word = prefix + String.fromCharCode(A_CODE + this.letter(edge));
      if (this.isWord(edge) && word.length >= 2 && (length == null || word.length === length)) results.push(word);
      if (results.length < limit) this.collect(this.target(edge), word, results, limit, length);
      if (this.isLast(edge)) break;
    }
  }

  /**
   * Mots composables avec un tirage. `letters` est une chaine ou `?` represente
   * un joker. Si `required` est fourni, le mot doit aussi contenir ces lettres
   * (elles sont supposees deja sur la grille, donc gratuites).
   *
   * `length` ne garde que les mots de cette longueur exacte, en coupant la
   * descente des que la longueur est atteinte : filtrer apres coup ferait buter
   * `limit` sur des mots de longueur non demandee.
   */
  anagrams(letters, { limit = 300, minLength = 2, length = null } = {}) {
    const counts = new Int8Array(27); // 26 = joker
    for (const char of letters.toUpperCase()) {
      if (char === '?' || char === ' ') counts[26]++;
      else {
        const letter = char.charCodeAt(0) - A_CODE;
        if (letter >= 0 && letter <= 25) counts[letter]++;
      }
    }

    const results = [];
    const walk = (node, prefix) => {
      if (node < 0 || results.length >= limit) return;
      for (let edge = node; ; edge++) {
        const letter = this.letter(edge);
        const usable = counts[letter] > 0 ? letter : counts[26] > 0 ? 26 : -1;
        if (usable >= 0) {
          counts[usable]--;
          const word = prefix + String.fromCharCode(A_CODE + letter);
          if (this.isWord(edge) && word.length >= minLength && (length == null || word.length === length)) {
            results.push(word);
          }
          if (length == null || word.length < length) walk(this.target(edge), word);
          counts[usable]++;
        }
        if (this.isLast(edge)) break;
      }
    };

    walk(ROOT, '');
    return results.sort((a, b) => b.length - a.length || a.localeCompare(b));
  }
}

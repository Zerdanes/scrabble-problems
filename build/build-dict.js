/**
 * Fabrique les dictionnaires binaires de l'application.
 *
 *   liste de mots (ODS)   ->  app/data/dict.bin       tous les mots autorises
 *   + build/freq-raw.txt  ->  app/data/common.bin     sous-ensemble "mots courants"
 *                         ->  app/data/dict-manifest.json
 *
 * Format binaire : un DAWG (automate acyclique deterministe minimal) serialise en
 * Uint32. Chaque case du tableau est un arc :
 *
 *   bits 0-4   : lettre (0 = A ... 25 = Z)
 *   bit  5     : le mot se termine ici
 *   bit  6     : dernier arc de la liste d'arcs du noeud
 *   bits 7-31  : index du premier arc du noeud d'arrivee (0 = pas de suite)
 *
 * Un noeud est simplement l'index de son premier arc ; la racine est a l'index 0,
 * ce qui permet d'utiliser 0 comme "pas de noeud d'arrivee" sans ambiguite.
 *
 * En ligne de commande :
 *   node build/build-dict.js            construit depuis la liste locale
 *   node build/build-dict.js --fetch    telecharge d'abord la liste a jour
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decodeWordList,
  validateWordList,
  fetchWordList,
  hashWords,
  readSourceConfig,
  ensureLocalFile,
  FREQUENCY_SOURCE,
} from './wordsource.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RAW_DIR = path.join(ROOT, 'build');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'app', 'data');
const WORDS_CACHE = path.join(RAW_DIR, 'mots-source.txt');
const FREQ_CACHE = path.join(RAW_DIR, 'freq-raw.txt');

/** Longueur maximale reellement posable sur un plateau de 15 cases. */
const BOARD_MAX_LEN = 15;

/**
 * Rang au-dela duquel un mot cesse d'etre considere comme "courant".
 * La liste de frequences vient de sous-titres : passe ~12 000, la queue est faite
 * de noms propres et d'onomatopees. Ce classement ne retire jamais un mot du jeu,
 * il sert seulement a promettre que la solution des niveaux Facile et Moyen est
 * un mot que tout le monde connait.
 */
const COMMON_RANK_LIMIT = 12000;

// ---------------------------------------------------------------- le DAWG

let nextNodeId = 0;
const newNode = () => ({ id: nextNodeId++, final: false, edges: new Map() });

/** Signature canonique d'un noeud dont les enfants sont deja minimises. */
function signature(node) {
  let key = node.final ? '1' : '0';
  for (const [letter, child] of node.edges) key += letter + child.id + ',';
  return key;
}

/** Construction incrementale de Daciuk : les mots doivent arriver tries. */
function buildDawg(sortedWords) {
  nextNodeId = 0;
  const register = new Map();
  const root = newNode();
  const unchecked = [];
  let previous = '';

  const minimizeTo = (depth) => {
    for (let i = unchecked.length - 1; i >= depth; i--) {
      const [parent, letter, child] = unchecked[i];
      const key = signature(child);
      const existing = register.get(key);
      if (existing) parent.edges.set(letter, existing);
      else register.set(key, child);
      unchecked.pop();
    }
  };

  for (const word of sortedWords) {
    let common = 0;
    const max = Math.min(word.length, previous.length);
    while (common < max && word[common] === previous[common]) common++;
    minimizeTo(common);

    let node = unchecked.length ? unchecked[unchecked.length - 1][2] : root;
    for (let i = common; i < word.length; i++) {
      const child = newNode();
      node.edges.set(word[i], child);
      unchecked.push([node, word[i], child]);
      node = child;
    }
    node.final = true;
    previous = word;
  }
  minimizeTo(0);
  return root;
}

function serialize(root, wordCount) {
  // Parcours en largeur : chaque noeud ayant des arcs recoit un bloc contigu.
  const firstEdge = new Map();
  const order = [];
  const seen = new Set([root.id]);
  const queue = [root];
  let cursor = 0;

  while (queue.length) {
    const node = queue.shift();
    if (node.edges.size === 0) continue;
    firstEdge.set(node.id, cursor);
    cursor += node.edges.size;
    order.push(node);
    for (const child of node.edges.values()) {
      if (!seen.has(child.id)) {
        seen.add(child.id);
        queue.push(child);
      }
    }
  }

  if (cursor >= 1 << 25) throw new Error("Trop d'arcs pour l'encodage sur 25 bits");

  const edges = new Uint32Array(cursor);
  const A = 'A'.charCodeAt(0);

  for (const node of order) {
    let index = firstEdge.get(node.id);
    const letters = [...node.edges.keys()].sort();
    letters.forEach((letter, i) => {
      const child = node.edges.get(letter);
      const target = child.edges.size ? firstEdge.get(child.id) : 0;
      edges[index++] =
        (letter.charCodeAt(0) - A) |
        (child.final ? 1 << 5 : 0) |
        (i === letters.length - 1 ? 1 << 6 : 0) |
        (target << 7);
    });
  }

  const buffer = Buffer.alloc(12 + edges.byteLength);
  buffer.writeUInt32LE(0x47574144, 0); // "DAWG"
  buffer.writeUInt32LE(cursor, 4);
  buffer.writeUInt32LE(wordCount, 8);
  Buffer.from(edges.buffer, edges.byteOffset, edges.byteLength).copy(buffer, 12);
  return { buffer, edgeCount: cursor, nodeCount: order.length };
}

// ------------------------------------------------------- mots courants

/**
 * La liste de frequences est batie sur des sous-titres : elle contient surtout des
 * formes non flechies. On la complete avec les flexions evidentes quand elles
 * existent dans l'ODS, sinon "courant" exclurait la moitie des coups naturels.
 */
function selectCommon(allWords) {
  const all = new Set(allWords);
  const common = new Set();

  let lines;
  try {
    lines = fs.readFileSync(FREQ_CACHE, 'utf8').split(/\r?\n/);
  } catch {
    return []; // pas de liste de frequences : on se passe du classement
  }

  let rank = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (++rank > COMMON_RANK_LIMIT) break;
    const word = line
      .split(' ')[0]
      .replace(/œ/g, 'oe')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase();
    if (/^[A-Z]{2,}$/.test(word) && all.has(word)) common.add(word);
  }

  for (const word of [...common]) {
    for (const suffix of ['S', 'E', 'ES', 'X', 'ENT']) {
      const variant = word + suffix;
      if (variant.length <= BOARD_MAX_LEN && all.has(variant)) common.add(variant);
    }
  }

  return [...common].sort();
}

// -------------------------------------------------------------- assemblage

function writeDawgFile(file, sortedWords) {
  const { buffer, edgeCount, nodeCount } = serialize(buildDawg(sortedWords), sortedWords.length);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return { words: sortedWords.length, edgeCount, nodeCount, bytes: buffer.length };
}

/**
 * Construit les deux dictionnaires dans `outDir`. Ecrit aussi le manifeste, qui
 * dit a l'application ce qu'elle a sous la main et permet de detecter une mise
 * a jour ulterieure.
 */
export function buildDictionaries({ words, outDir = OUT_DIR, source, etag = null }) {
  const dict = writeDawgFile(path.join(outDir, 'dict.bin'), words);
  const common = writeDawgFile(path.join(outDir, 'common.bin'), selectCommon(words));

  const manifest = {
    source: source ?? readSourceConfig(DATA_DIR),
    words: dict.words,
    common: common.words,
    playable: words.filter((word) => word.length <= BOARD_MAX_LEN).length,
    hash: hashWords(words),
    etag,
    installedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, 'dict-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  return { dict, common, manifest };
}

// -------------------------------------------------------------------- CLI

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  let source = readSourceConfig(DATA_DIR);
  const wantsFetch = process.argv.includes('--fetch') || !fs.existsSync(WORDS_CACHE);

  // Ni la liste de mots ni la liste de frequences ne sont versionnees : au
  // premier lancement on les recupere, ensuite elles restent en cache.
  await ensureLocalFile(FREQ_CACHE, FREQUENCY_SOURCE.url, 'liste de frequences (classement courant/rare)');

  let words;
  let etag = null;

  if (wantsFetch) {
    console.log(`Telechargement de la liste : ${source.url}`);
    const result = await fetchWordList(source);
    words = validateWordList(result.words, result.rejected);
    etag = result.etag;
    fs.writeFileSync(WORDS_CACHE, words.join('\n'), 'utf8');
    console.log(`  ${words.length} mots recus (${result.rejected} lignes ignorees)`);
  } else {
    const decoded = decodeWordList(fs.readFileSync(WORDS_CACHE, 'utf8'));
    words = validateWordList(decoded.words, decoded.rejected);
    console.log(`Liste locale : ${words.length} mots (${WORDS_CACHE})`);
    // On ne sait pas quelle edition contient ce fichier : mieux vaut l'avouer que
    // d'estampiller le manifeste avec le libelle de la source configuree, qui
    // decrit ce qu'on telechargerait, pas ce qu'on installe.
    source = {
      id: 'local',
      label: `Liste locale (${path.basename(WORDS_CACHE)}) — édition non identifiée`,
      url: source.url,
      page: source.page,
    };
  }

  const { dict, common, manifest } = buildDictionaries({ words, source, etag });
  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} Mo`;
  console.log(`dict.bin     ${String(dict.words).padStart(7)} mots  ${String(dict.nodeCount).padStart(6)} noeuds  ${mb(dict.bytes)}`);
  console.log(`common.bin   ${String(common.words).padStart(7)} mots  ${String(common.nodeCount).padStart(6)} noeuds  ${mb(common.bytes)}`);
  console.log(`\n${manifest.source.label}`);
  console.log(`dont ${manifest.playable} posables sur le plateau (15 lettres ou moins)`);
}

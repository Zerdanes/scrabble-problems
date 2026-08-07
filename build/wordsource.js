/**
 * D'ou viennent les mots, et comment on verifie qu'ils sont utilisables.
 *
 * Precision importante : il n'existe pas d'API officielle de l'ODS. La Federation
 * et Larousse ne publient pas de liste lisible par une machine. Ce que l'on peut
 * suivre, ce sont des listes tenues par la communaute. La source est donc
 * declaree dans data/dict-source.json et reste modifiable sans toucher au code.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

/** Source par defaut : meme auteur que la liste ODS8 utilisee jusqu'ici. */
export const DEFAULT_SOURCE = {
  id: 'ods9',
  label: 'ODS9 — Officiel du Scrabble, édition 9 (en vigueur du 1ᵉʳ janvier 2024 au 31 décembre 2027)',
  url: 'https://raw.githubusercontent.com/Thecoolsim/ODS9/main/words.js',
  page: 'https://github.com/Thecoolsim/ODS9',
};

/**
 * Liste de frequences (MIT, Hermit Dave, batie sur OpenSubtitles). Elle ne dit
 * jamais si un mot est autorise : elle sert uniquement a savoir si un mot est
 * connu du grand public, pour calibrer les niveaux Facile et Moyen.
 */
export const FREQUENCY_SOURCE = {
  url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/fr/fr_50k.txt',
  page: 'https://github.com/hermitdave/FrequencyWords',
};

/** Telecharge un fichier texte si absent du disque. Renvoie son contenu. */
export async function ensureLocalFile(file, url, label) {
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  console.log(`Telechargement : ${label}`);
  const response = await fetch(url, { headers: { 'User-Agent': 'scrabble-defi' } });
  if (!response.ok) throw new Error(`${label} : la source a répondu ${response.status}.`);
  const text = await response.text();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return text;
}

/**
 * Mots temoins. Une liste qui ne les contient pas tous n'est pas un dictionnaire
 * de Scrabble francais : on refuse plutot que d'ecraser ce qui marche.
 */
const WITNESSES = ['BONJOUR', 'MAISON', 'CHAT', 'ZEBRE', 'QUOTIDIEN', 'AA', 'SCRABBLE'];
const MIN_WORDS = 300000;

export function readSourceConfig(dataDir) {
  const file = path.join(dataDir, 'dict-source.json');
  try {
    // Le Bloc-notes de Windows ecrit un BOM en tete : sans ce nettoyage, un
    // fichier parfaitement valide serait rejete et la configuration ignoree en
    // silence, ce qui est le pire des comportements.
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    return { ...DEFAULT_SOURCE, ...JSON.parse(raw) };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`data/dict-source.json illisible (${error.message}), source par defaut utilisee.`);
    }
    return { ...DEFAULT_SOURCE };
  }
}

/**
 * Deux formats acceptes, devines au contenu :
 *   - `const WORDS_GZ="<base64 d'un gzip>";`  (format du depot ODS9)
 *   - une liste brute, un mot par ligne
 * De cette facon la source peut etre repointee vers n'importe quel fichier texte.
 */
export function decodeWordList(payload) {
  const base64 = payload.match(/^\s*(?:const|var|let)\s+\w+\s*=\s*"([A-Za-z0-9+/=]+)"/)?.[1];
  const text = base64
    ? zlib.gunzipSync(Buffer.from(base64, 'base64')).toString('utf8')
    : payload;

  const words = [];
  const seen = new Set();
  let rejected = 0;

  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    const word = raw
      .replace(/œ/g, 'oe')
      .replace(/Œ/g, 'OE')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase();
    if (!/^[A-Z]{2,}$/.test(word)) {
      rejected++;
      continue;
    }
    if (seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }

  return { words: words.sort(), rejected, compressed: Boolean(base64) };
}

/** Renvoie la liste si elle est saine, jette sinon. `installed` sert de garde-fou. */
export function validateWordList(words, rejected, installed = 0) {
  if (words.length < MIN_WORDS) {
    throw new Error(`Seulement ${words.length} mots lisibles : liste incomplète ou illisible, mise à jour refusée.`);
  }
  if (rejected > words.length * 0.02) {
    throw new Error(`${rejected} lignes inexploitables : le fichier ne ressemble pas à une liste de mots.`);
  }
  const missing = WITNESSES.filter((word) => !binarySearch(words, word));
  if (missing.length) {
    throw new Error(`Mots courants absents (${missing.join(', ')}) : ce n'est pas un dictionnaire de Scrabble français.`);
  }
  // Une liste qui fond de plus de 5 % signale un incident chez la source, pas une
  // nouvelle edition : l'ODS9 n'a retire que 64 mots sur 411 430.
  if (installed && words.length < installed * 0.95) {
    throw new Error(
      `La liste proposée (${words.length} mots) est bien plus courte que l'actuelle (${installed}) : mise à jour refusée par précaution.`
    );
  }
  return words;
}

function binarySearch(sorted, target) {
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] === target) return true;
    if (sorted[mid] < target) low = mid + 1;
    else high = mid - 1;
  }
  return false;
}

export function hashWords(words) {
  return crypto.createHash('sha256').update(words.join('\n')).digest('hex').slice(0, 16);
}

/**
 * Telecharge la liste distante. `etag` evite de retelecharger 1,3 Mo pour rien :
 * GitHub repond 304 quand le fichier n'a pas bouge.
 */
export async function fetchWordList(source, etag = null) {
  const headers = { 'User-Agent': 'scrabble-defi' };
  if (etag) headers['If-None-Match'] = etag;

  const response = await fetch(source.url, { headers, redirect: 'follow' });
  if (response.status === 304) return { unchanged: true };
  if (!response.ok) throw new Error(`La source a répondu ${response.status}.`);

  const payload = await response.text();
  const { words, rejected } = decodeWordList(payload);
  return {
    unchanged: false,
    words,
    rejected,
    etag: response.headers.get('etag'),
  };
}

export async function writeJson(file, value) {
  await fsp.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

/**
 * Petit serveur local. Il ne sert que deux choses :
 *   - les fichiers de app/ (un module ES a besoin d'un vrai http://, file:// est refuse)
 *   - la sauvegarde, dans data/state.json
 *
 * Aucune dependance, aucun acces reseau sortant : tout reste sur la machine.
 * Le serveur s'arrete tout seul quand la fenetre du jeu est fermee.
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildDictionaries } from './build/build-dict.js';
import {
  fetchWordList,
  validateWordList,
  hashWords,
  readSourceConfig,
  decodeWordList,
} from './build/wordsource.js';
import { Dawg } from './app/js/dawg.js';
import { defineWord } from './build/definitions.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'app');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const BACKUP_FILE = path.join(DATA_DIR, 'state.backup.json');

const FIRST_PORT = 7317;
const IDLE_TIMEOUT = 15 * 60_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

fs.mkdirSync(DATA_DIR, { recursive: true });

// --------------------------------------------------------------- sauvegarde

/** Ecriture atomique : on ne veut pas d'un state.json tronque en cas de coupure. */
async function writeState(payload) {
  const temporary = `${STATE_FILE}.tmp`;
  await fsp.writeFile(temporary, payload, 'utf8');
  if (fs.existsSync(STATE_FILE)) await fsp.copyFile(STATE_FILE, BACKUP_FILE).catch(() => {});
  await fsp.rename(temporary, STATE_FILE);
}

async function readState() {
  for (const file of [STATE_FILE, BACKUP_FILE]) {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch {
      /* fichier absent ou illisible : on tente la sauvegarde de secours */
    }
  }
  return { stats: {}, current: null };
}

// ------------------------------------------------------- mise a jour des mots

const DICT_DIR = path.join(PUBLIC_DIR, 'data');
const MANIFEST = path.join(DICT_DIR, 'dict-manifest.json');
const BACKUP_DIR = path.join(DATA_DIR, 'dictionnaire-precedent');
const STAGING_DIR = path.join(DATA_DIR, 'dictionnaire-en-preparation');
const WORDS_CACHE = path.join(ROOT, 'build', 'mots-source.txt');
const DICT_FILES = ['dict.bin', 'common.bin', 'dict-manifest.json'];

/** Liste retenue par une verification, gardee en memoire pour ne pas retelecharger. */
let staged = null;

const readManifest = () => {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch {
    return null;
  }
};

const readInstalledWords = () => {
  try {
    return new Set(fs.readFileSync(WORDS_CACHE, 'utf8').split('\n').filter(Boolean));
  } catch {
    return null;
  }
};

/**
 * Compare la liste distante a celle installee. Ne modifie rien : c'est au joueur
 * de decider. Sans reseau, on repond "hors ligne" et l'application n'en parle pas.
 */
async function checkForUpdate() {
  const manifest = readManifest();
  const source = readSourceConfig(DATA_DIR);

  let result;
  try {
    result = await fetchWordList(source, manifest?.etag);
  } catch (error) {
    return { status: 'offline', message: error.message, source };
  }

  if (result.unchanged) return { status: 'current', source, words: manifest?.words ?? 0 };

  const words = validateWordList(result.words, result.rejected, manifest?.words ?? 0);
  const hash = hashWords(words);

  if (manifest && hash === manifest.hash) {
    // Meme contenu, ETag different : on retient le nouvel ETag pour les prochains
    // demarrages, et on ne derange pas le joueur.
    await fsp.writeFile(MANIFEST, JSON.stringify({ ...manifest, etag: result.etag }, null, 2), 'utf8');
    return { status: 'current', source, words: manifest.words };
  }

  // Difference par ensembles : sur 400 000 mots, tout le reste est trop lent.
  const installed = readInstalledWords();
  const proposed = new Set(words);
  const added = installed ? words.filter((word) => !installed.has(word)) : [];
  const removed = installed ? [...installed].filter((word) => !proposed.has(word)) : [];

  staged = { words, etag: result.etag, source };

  return {
    status: 'available',
    source,
    words: words.length,
    installedWords: manifest?.words ?? null,
    added: added.length,
    removed: removed.length,
    addedSample: added.slice(0, 8),
    removedSample: removed.slice(0, 8),
  };
}

/**
 * Installe la liste retenue. Rien n'est ecrase avant que le nouveau dictionnaire
 * n'ait ete construit ET relu avec succes ; l'ancien est conserve pour un retour
 * arriere. En cas de pepin a n'importe quelle etape, on ne touche a rien.
 */
async function applyUpdate() {
  if (!staged) throw new Error('Aucune mise à jour vérifiée. Relancez la vérification.');

  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  // 1. Construction a l'ecart, dans un dossier temporaire.
  const built = buildDictionaries({
    words: staged.words,
    outDir: STAGING_DIR,
    source: staged.source,
    etag: staged.etag,
  });

  // 2. Relecture reelle du fichier produit : un binaire qui ne se relit pas ne
  //    doit jamais atteindre app/data.
  const buffer = fs.readFileSync(path.join(STAGING_DIR, 'dict.bin'));
  const control = Dawg.fromBuffer(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  );
  for (const witness of ['BONJOUR', 'MAISON', 'CHAT', 'SCRABBLE']) {
    if (!control.has(witness)) throw new Error(`Dictionnaire construit inutilisable (${witness} introuvable).`);
  }
  if (control.wordCount !== staged.words.length) {
    throw new Error('Le dictionnaire construit ne contient pas le nombre de mots attendu.');
  }

  // 3. Sauvegarde de l'existant, puis bascule.
  fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  for (const name of DICT_FILES) {
    const current = path.join(DICT_DIR, name);
    if (fs.existsSync(current)) fs.copyFileSync(current, path.join(BACKUP_DIR, name));
  }
  for (const name of DICT_FILES) {
    fs.copyFileSync(path.join(STAGING_DIR, name), path.join(DICT_DIR, name));
  }

  fs.writeFileSync(WORDS_CACHE, staged.words.join('\n'), 'utf8');
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });

  const applied = { words: built.manifest.words, common: built.manifest.common, source: staged.source };
  staged = null;
  return applied;
}

/** Restaure le dictionnaire precedent, si une sauvegarde existe. */
async function rollbackUpdate() {
  const missing = DICT_FILES.filter((name) => !fs.existsSync(path.join(BACKUP_DIR, name)));
  if (missing.length) throw new Error('Aucun dictionnaire précédent à restaurer.');
  for (const name of DICT_FILES) {
    fs.copyFileSync(path.join(BACKUP_DIR, name), path.join(DICT_DIR, name));
  }
  const restored = readManifest();
  try {
    const decoded = decodeWordList(fs.readFileSync(WORDS_CACHE, 'utf8'));
    if (decoded.words.length !== restored?.words) fs.rmSync(WORDS_CACHE, { force: true });
  } catch {
    /* le cache sera refait a la prochaine verification */
  }
  return { words: restored?.words ?? 0, source: restored?.source };
}

// ------------------------------------------------------------- definitions

const DEFINITIONS_FILE = path.join(DATA_DIR, 'definitions.json');

/**
 * Cache des definitions deja consultees. Il grossit a l'usage : les mots regardes
 * une fois restent lisibles sans connexion. C'est aussi ce qui evite de solliciter
 * le Wiktionnaire pour rien.
 */
let definitions = null;
let definitionsDirty = false;

function loadDefinitions() {
  if (definitions) return definitions;
  try {
    definitions = JSON.parse(fs.readFileSync(DEFINITIONS_FILE, 'utf8'));
  } catch {
    definitions = {};
  }
  return definitions;
}

// Ecriture groupee : une consultation de dictionnaire peut enchainer les mots.
setInterval(() => {
  if (!definitionsDirty) return;
  definitionsDirty = false;
  fsp.writeFile(DEFINITIONS_FILE, JSON.stringify(definitions), 'utf8').catch(() => {});
}, 4000).unref();

/**
 * Un resultat vide n'est pas garde indefiniment : le Wiktionnaire s'enrichit, et
 * surtout une reponse tronquee un jour de reseau capricieux figerait le mot a
 * "pas de definition" pour toujours. On retente au bout d'une semaine.
 */
const EMPTY_RETRY = 7 * 24 * 60 * 60 * 1000;

function usable(entry) {
  if (!entry) return false;
  if (entry.entries?.length) return true;
  return Date.now() - Date.parse(entry.fetchedAt ?? 0) < EMPTY_RETRY;
}

async function lookupDefinition(word) {
  const key = word.trim().toUpperCase();
  const cache = loadDefinitions();
  if (usable(cache[key])) return { ...cache[key], cached: true };

  const result = await defineWord(key);
  cache[key] = result;
  definitionsDirty = true;
  return { ...result, cached: false };
}

// ------------------------------------------------------------------ requetes

function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(body);
}

async function serveStatic(url, response) {
  const relative = url === '/' ? 'index.html' : decodeURIComponent(url.slice(1));
  const target = path.join(PUBLIC_DIR, relative);

  // Aucun echappement hors de app/.
  if (!target.startsWith(PUBLIC_DIR)) return send(response, 403, 'Interdit', 'text/plain');

  try {
    const data = await fsp.readFile(target);
    send(response, 200, data, MIME[path.extname(target)] ?? 'application/octet-stream');
  } catch {
    send(response, 404, 'Introuvable', 'text/plain');
  }
}

let lastPing = 0;

/**
 * Une seule fenetre a la main.
 *
 * Deux fenetres ouvertes sur le jeu feraient tourner deux chronometres et
 * ecriraient tour a tour la meme sauvegarde. L'arbitrage est fait ici, et non
 * entre les fenetres : un onglet mis en arriere-plan par Windows voit ses
 * minuteries ralenties et ses messages retardes, il ne peut pas arbitrer de
 * facon fiable.
 *
 * La fenetre active se signale par ses battements. Si elle se tait plus de
 * SESSION_TTL (fermeture, plantage, mise en veille de la machine), la premiere
 * fenetre qui bat reprend la main d'elle-meme : rien ne reste bloque.
 */
const SESSION_TTL = 25_000;
let session = { id: null, lastSeen: 0 };

function claimSession(id, { force = false } = {}) {
  const now = Date.now();
  const abandoned = now - session.lastSeen > SESSION_TTL;
  if (force || !session.id || abandoned || session.id === id) {
    session = { id, lastSeen: now };
    return { active: true };
  }
  return { active: false };
}

/**
 * La fenetre previent qu'elle se ferme. Sans cela il faudrait attendre
 * l'expiration du delai, et relancer le jeu dans la foulee afficherait
 * "deja ouvert" alors qu'il ne l'est plus.
 */
function releaseSession(id) {
  if (session.id === id) session = { id: null, lastSeen: 0 };
}

const server = http.createServer(async (request, response) => {
  const { url, method } = request;

  if (url === '/api/state' && method === 'GET') {
    return send(response, 200, JSON.stringify(await readState()));
  }

  if (url === '/api/state' && method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    try {
      JSON.parse(body); // on refuse d'ecrire un fichier qu'on ne saura pas relire
      await writeState(body);
      return send(response, 200, '{"ok":true}');
    } catch {
      return send(response, 400, '{"ok":false}');
    }
  }

  if (url.startsWith('/api/session/release')) {
    releaseSession(new URL(url, 'http://localhost').searchParams.get('id') ?? '');
    return send(response, 200, '{"ok":true}');
  }

  if (url.startsWith('/api/ping')) {
    lastPing = Date.now();
    const params = new URL(url, 'http://localhost').searchParams;
    const id = params.get('id') ?? '';
    const state = claimSession(id, { force: params.get('force') === '1' });
    return send(response, 200, JSON.stringify({ ok: true, ...state }));
  }

  // Mise a jour du dictionnaire : verifier, installer, revenir en arriere.
  // Aucune de ces routes ne s'execute d'elle-meme, c'est toujours le joueur qui
  // declenche depuis la page d'aide.
  if (url.startsWith('/api/define')) {
    const word = new URL(url, 'http://localhost').searchParams.get('mot') ?? '';
    try {
      return send(response, 200, JSON.stringify({ ok: true, ...(await lookupDefinition(word)) }));
    } catch (error) {
      // Hors ligne ou Wiktionnaire indisponible : ce n'est pas une panne du jeu.
      return send(response, 200, JSON.stringify({ ok: false, word: word.toUpperCase(), error: error.message }));
    }
  }

  if (url === '/api/dict/status') {
    return send(
      response,
      200,
      JSON.stringify({
        ok: true,
        manifest: readManifest(),
        hasBackup: DICT_FILES.every((name) => fs.existsSync(path.join(BACKUP_DIR, name))),
      })
    );
  }

  const dictActions = {
    '/api/dict/check': checkForUpdate,
    '/api/dict/apply': applyUpdate,
    '/api/dict/rollback': rollbackUpdate,
  };
  if (dictActions[url]) {
    if (method !== 'POST') return send(response, 405, '{"ok":false}');
    try {
      return send(response, 200, JSON.stringify({ ok: true, ...(await dictActions[url]()) }));
    } catch (error) {
      console.error(`${url} : ${error.message}`);
      return send(response, 200, JSON.stringify({ ok: false, error: error.message }));
    }
  }

  if (method !== 'GET') return send(response, 405, 'Methode non autorisee', 'text/plain');
  return serveStatic(url.split('?')[0], response);
});

// ------------------------------------------------------------------ demarrage

/**
 * Le jeu est-il deja lance ? Sans ce controle, un deuxieme double-clic demarre
 * un serveur sur le port suivant, et les deux ecrivent dans le meme
 * data/state.json : la partie en cours d'une fenetre ecrase celle de l'autre.
 * On prefere rendre la main a la fenetre existante.
 */
async function findRunningInstance() {
  for (let port = FIRST_PORT; port < FIRST_PORT + 12; port++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/dict/status`, {
        signal: AbortSignal.timeout(500),
      });
      if (!response.ok) continue;
      const body = await response.json();
      if (body.ok && 'manifest' in body) return port; // c'est bien notre application
    } catch {
      // port ferme (immediat) ou occupe par autre chose : on passe au suivant
    }
  }
  return null;
}

function listen(port, attempt = 0) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempt < 12) return listen(port + 1, attempt + 1);
    console.error('Impossible de demarrer le serveur :', error.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => onReady(port));
}

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

/**
 * Le jeu a-t-il ete installe comme application (menu Edge > Applications >
 * Installer ce site) ? Windows cree alors un raccourci dans le menu Demarrer,
 * qui porte l'identite de l'application : c'est ce qui donne une entree propre
 * dans la barre des taches, avec notre icone, au lieu de celle d'Edge.
 *
 * On preferera toujours lancer ce raccourci : lui seul a la bonne identite.
 * Une fenetre ouverte avec --app= reste, pour Windows, une fenetre d'Edge.
 */
function findInstalledShortcut() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$shell = New-Object -ComObject WScript.Shell
$roots = @(
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs'),
  [Environment]::GetFolderPath('Desktop'),
  # Le raccourci pose par le navigateur est ecarte du Bureau, ou il ouvrait une
  # page d'erreur, mais conserve ici : il porte l'identite de l'application
  # installee, donc son icone dans la barre des taches.
  '${path.join(ROOT, 'raccourcis-ecartes')}'
)
foreach ($root in $roots) {
  if (-not $root -or -not (Test-Path $root)) { continue }
  Get-ChildItem $root -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $link = $shell.CreateShortcut($_.FullName)
    # Edge pointe ses applications installees sur msedge_proxy.exe, pas sur
    # msedge.exe, et depose le raccourci sur le Bureau plutot que dans le menu
    # Demarrer. Chercher le mauvais nom au mauvais endroit revenait a ne jamais
    # trouver l'application, meme installee.
    if ($link.TargetPath -like '*msedge*.exe' -and $link.Arguments -like '*--app-id=*' -and $_.BaseName -like '*crabble*') {
      Write-Output $_.FullName
    }
  }
}`;

  try {
    const found = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 6000,
      windowsHide: true,
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return found[0] ?? null;
  } catch {
    return null; // pas de PowerShell, pas de raccourci : on retombe sur --app=
  }
}

/** Fenetre sans barre d'adresse ni onglets : on veut que ca ressemble a un logiciel. */
function openWindow(url) {
  const installed = findInstalledShortcut();
  if (installed) {
    console.log('  Application installee detectee : ouverture avec son icone.');
    spawn('cmd', ['/c', 'start', '""', installed], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  const browser = BROWSERS.find((candidate) => fs.existsSync(candidate));
  if (browser) {
    spawn(browser, [`--app=${url}`, '--window-size=1280,860'], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
  }
}

function onReady(port) {
  const url = `http://localhost:${port}/`;
  console.log('');
  console.log('  Scrabble - Le Defi');
  console.log(`  ${url}`);
  console.log('  Cette fenetre se fermera d\'elle-meme apres la partie.');
  console.log('');
  if (!process.env.SCRAB_NO_OPEN) openWindow(url);

  // Le navigateur envoie un battement toutes les 10 s. Le delai est large : une
  // fenetre reduite voit ses minuteries ralenties par Windows, et il vaut mieux
  // un node qui traine un quart d'heure qu'une application morte au retour.
  setInterval(() => {
    if (lastPing && Date.now() - lastPing > IDLE_TIMEOUT) {
      console.log('Fenetre fermee, arret du serveur.');
      process.exit(0);
    }
  }, 30_000);
}

const running = await findRunningInstance();
if (running) {
  console.log(`\n  Le jeu est deja ouvert (port ${running}). Retour a la fenetre existante.\n`);
  if (!process.env.SCRAB_NO_OPEN) openWindow(`http://localhost:${running}/`);
  process.exit(0);
}

listen(FIRST_PORT);

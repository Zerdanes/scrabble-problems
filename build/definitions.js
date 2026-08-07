/**
 * Definitions, tirees du Wiktionnaire francais.
 *
 * Trois difficultes, qui expliquent la forme du code :
 *
 *  1. L'ODS ecrit les mots sans accent. « ZEBRE » ne designe aucune page : il
 *     faut retrouver « zebre » (breton !), « zebre » et « zebre ». On cherche donc
 *     toutes les graphies accentuees et on les renvoie toutes.
 *  2. Une page du Wiktionnaire contient plusieurs langues. Il faut isoler la
 *     section francaise, sinon « ZEBRE » renvoie une etymologie bretonne.
 *  3. La plupart des formes de l'ODS sont flechies : « IMAMS » ne donne que
 *     « Pluriel de imam ». On remonte alors au mot de base pour ajouter sa
 *     definition, qui est celle que le joueur cherchait.
 */

const USER_AGENT =
  'scrabble-defi/1.0 (application personnelle; https://github.com/Zerdanes/scrabble-problems)';
const API = 'https://fr.wiktionary.org/w/api.php';

/** Le Wiktionnaire demande de rester raisonnable : une requete a la fois, espacees. */
const MIN_INTERVAL = 320;
let queue = Promise.resolve();
let lastCall = 0;

function scheduled(task) {
  queue = queue.then(async () => {
    const wait = MIN_INTERVAL - (Date.now() - lastCall);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();
    return task();
  });
  return queue;
}

const stripAccents = (value) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function callApi(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Wiktionnaire : HTTP ${response.status}`);
  return response.json();
}

async function pageSource(title) {
  const data = await scheduled(() =>
    callApi({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      redirects: '1',
      titles: title,
    })
  );
  const page = data?.query?.pages?.[0];
  if (!page || page.missing) return null;
  return page.revisions?.[0]?.slots?.main?.content ?? null;
}

/** Graphies accentuees correspondant a une forme sans accent. */
async function spellings(word) {
  const data = await scheduled(() =>
    callApi({ action: 'query', list: 'search', srsearch: `intitle:${word}`, srlimit: '10' })
  );
  const hits = data?.query?.search?.map((hit) => hit.title) ?? [];
  return hits.filter((title) => stripAccents(title) === stripAccents(word));
}

/** Transforme une ligne de wikitexte en phrase lisible. */
function cleanup(line) {
  return line
    .replace(/\{\{[^{}]*\}\}/g, (match) => {
      const parts = match.slice(2, -2).split('|');
      const kind = parts[0].toLowerCase();
      if (['lexique', 'term', 'figure', 'familier', 'vieilli', 'argot', 'pejoratif', 'populaire'].includes(stripAccents(kind))) {
        const labels = parts.slice(1).filter((part) => part !== 'fr' && !part.includes('='));
        return labels.length ? `(${labels.join(', ')}) ` : '';
      }
      return '';
    })
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([.,;])/g, '$1')
    .trim();
}

/** Premiere definition de la section francaise, et sa nature grammaticale. */
function frenchDefinition(source) {
  if (!source) return null;
  const start = source.search(/^==\s*\{\{langue\|fr\}\}\s*==/m);
  if (start < 0) return null;
  const rest = source.slice(start + 1);
  const end = rest.search(/^==\s*\{\{langue\|(?!fr\}\})/m);
  const section = end < 0 ? rest : rest.slice(0, end);

  let kind = null;
  for (const line of section.split('\n')) {
    const heading = line.match(/^===+\s*\{\{S\|([^|}]+)/);
    if (heading) kind = heading[1].replace(/-/g, ' ');
    if (!/^#[^*:]/.test(line)) continue;
    const text = cleanup(line.replace(/^#\s*/, ''));
    if (text.length > 3) return { text, kind };
  }
  return null;
}

/**
 * « Pluriel de imam », « Feminin pluriel de decevant », « Troisieme personne du
 * pluriel de l'indicatif present du verbe telecharger » : on isole le mot de base.
 */
function baseWord(definition) {
  // « Pluriel de imam », « Feminin pluriel de decevant », « Variante
  // typographique d'oeil » : l'apostrophe peut etre collee, et le mot de base
  // peut contenir une ligature.
  const match = definition.match(
    /\b(?:pluriel|singulier|f[ée]minin|masculin|participe|personne|forme|variante|orthographe)\b.*?\bd(?:[eu]\s+|['’]\s*)(?:verbe\s+|l['’]\s*|la\s+|le\s+)?([a-zà-öø-ÿœæ'’-]{2,})\s*\.?$/i
  );
  return match ? match[1].replace(/[’]/g, "'") : null;
}

/**
 * Definition complete d'un mot de l'ODS. Renvoie toujours un objet : `entries`
 * peut etre vide si le Wiktionnaire ne connait pas le mot, ce qui n'est pas une
 * erreur (l'ODS contient des formes que le Wiktionnaire n'a pas detaillees).
 */
export async function defineWord(word) {
  const cleaned = word.trim().toUpperCase();
  if (!/^[A-Z]{2,}$/.test(cleaned)) throw new Error('Mot invalide.');

  const candidates = [];
  const direct = await pageSource(cleaned.toLowerCase());
  const directDefinition = frenchDefinition(direct);
  if (directDefinition) candidates.push({ title: cleaned.toLowerCase(), ...directDefinition });

  // On cherche les graphies accentuees meme quand la forme nue a marche : ZEBRE
  // est a la fois « zebre » et « zebre », et le joueur veut voir les deux.
  for (const title of await spellings(cleaned)) {
    if (candidates.some((entry) => entry.title === title)) continue;
    const definition = frenchDefinition(await pageSource(title));
    // Les noms propres ne sont jamais jouables : les afficher n'ajouterait que
    // du bruit sous un mot que le joueur vient de valider.
    if (definition && !/nom propre/i.test(definition.kind ?? '')) candidates.push({ title, ...definition });
    if (candidates.length >= 3) break;
  }

  // Remontee au mot de base pour les formes flechies.
  for (const entry of candidates) {
    const base = baseWord(entry.text);
    if (!base || stripAccents(base) === stripAccents(entry.title)) continue;
    const definition = frenchDefinition(await pageSource(base));
    if (definition) entry.base = { title: base, text: definition.text };
  }

  return { word: cleaned, entries: candidates, fetchedAt: new Date().toISOString() };
}

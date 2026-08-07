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

/** Modeles qui portent une nuance d'emploi : on les rend entre parentheses. */
const LABELS = new Set([
  'lexique', 'term', 'figure', 'familier', 'vieilli', 'argot', 'pejoratif', 'populaire',
  'desuet', 'rare', 'litteraire', 'soutenu', 'poetique', 'didactique', 'ironique',
  'injurieux', 'vulgaire', 'neologisme', 'anglicisme', 'enfantin', 'region',
  'par extension', 'par analogie', 'analogie', 'specialement', 'absolument',
  'sens propre', 'au masculin', 'au feminin', 'au pluriel', 'au singulier',
  'nom collectif', 'quebec', 'suisse', 'belgique', 'canada', 'afrique', 'france',
]);

/**
 * Modeles de renvoi : « {{variante de|lumbago|fr}} », « {{variante ortho
 * de|voûter|fr}} ». Ils constituent parfois TOUTE la definition ; les vider
 * laissait la page sans rien a afficher (LOMBAGO, VOUTER, FIORD, TOKAI...).
 * On les rend en clair, ce qui permet en prime a baseWord() de remonter au mot
 * vise et d'ajouter sa definition.
 */
function reference(parts) {
  const name = parts[0].trim().replace(/\bortho\b/i, 'orthographique');
  const target = parts.slice(1).find((part) => !part.includes('=') && part !== 'fr');
  if (!target) return null;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${target}`;
}

/** Transforme une ligne de wikitexte en phrase lisible. */
function cleanup(line) {
  return line
    .replace(/\{\{[^{}]*\}\}/g, (match) => {
      const parts = match.slice(2, -2).split('|');
      const kind = stripAccents(parts[0]).trim();
      if (LABELS.has(kind)) {
        const labels = parts.slice(1).filter((part) => part !== 'fr' && !part.includes('='));
        return labels.length ? `(${labels.join(', ')}) ` : '';
      }
      // « lien » et « w » ne sont que des liens : on garde le mot lie.
      if (kind === 'lien' || kind === 'w') {
        return parts.slice(1).find((part) => !part.includes('=') && part !== 'fr') ?? '';
      }
      if (/(^|\s)de$/.test(kind)) return reference(parts) ?? '';
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

/** Toutes les entrees francaises pour une graphie de l'ODS, accents compris. */
async function collect(word) {
  const candidates = [];
  const lower = word.toLowerCase();
  const direct = frenchDefinition(await pageSource(lower));
  if (direct) candidates.push({ title: lower, ...direct });

  // On cherche les graphies accentuees meme quand la forme nue a marche : ZEBRE
  // est a la fois « zebre » et « zebre », et le joueur veut voir les deux.
  for (const title of await spellings(word)) {
    if (candidates.some((entry) => entry.title === title)) continue;
    const definition = frenchDefinition(await pageSource(title));
    // Les noms propres ne sont jamais jouables : les afficher n'ajouterait que
    // du bruit sous un mot que le joueur vient de valider.
    if (definition && !/nom propre/i.test(definition.kind ?? '')) candidates.push({ title, ...definition });
    if (candidates.length >= 3) break;
  }
  return candidates;
}

/**
 * Une definition qui n'est QUE le renvoi vers une autre graphie, une fois les
 * etiquettes d'emploi retirees : « Variante orthographique de thune. »
 */
const REDIRECT_ONLY = /^(?:\([^)]*\)\s*)*(?:variante|graphie|orthographe|ancienne orthographe)\b/i;

/** Remontee au mot de base pour les formes flechies. */
async function attachBases(candidates) {
  for (const entry of candidates) {
    let title = baseWord(entry.text);
    if (!title || stripAccents(title) === stripAccents(entry.title)) continue;
    let definition = frenchDefinition(await pageSource(title));
    if (!definition) continue;

    // « TUNES » mene a « tune », qui n'est lui-meme qu'un renvoi vers « thune ».
    // Un saut de plus tombe sur le sens. On ne le tente que si la page atteinte
    // ne dit rien d'autre que ce renvoi, sinon une definition ordinaire
    // contenant « sous forme de X » nous ferait deriver vers X.
    if (REDIRECT_ONLY.test(definition.text)) {
      const next = baseWord(definition.text);
      if (next && stripAccents(next) !== stripAccents(title)) {
        const deeper = frenchDefinition(await pageSource(next));
        if (deeper) {
          title = next;
          definition = deeper;
        }
      }
    }
    entry.base = { title, text: definition.text };
  }
}

/**
 * Singuliers plausibles d'une forme de l'ODS. L'ODS admet des pluriels que le
 * Wiktionnaire ne decrit pas du tout : QIS (« qi » y est donne invariable),
 * BIBS, TOKAIS. Plutot que de ne rien afficher, on tente le singulier.
 */
function singulars(word) {
  const forms = [];
  if (word.length >= 4 && word.endsWith('AUX')) forms.push(`${word.slice(0, -3)}AL`);
  if (word.length >= 3 && /[SX]$/.test(word)) forms.push(word.slice(0, -1));
  return forms;
}

/**
 * Definition complete d'un mot de l'ODS. Renvoie toujours un objet : `entries`
 * peut etre vide si le Wiktionnaire ne connait pas le mot, ce qui n'est pas une
 * erreur (l'ODS contient des formes que le Wiktionnaire n'a pas detaillees).
 */
export async function defineWord(word) {
  const cleaned = word.trim().toUpperCase();
  if (!/^[A-Z]{2,}$/.test(cleaned)) throw new Error('Mot invalide.');

  const candidates = await collect(cleaned);
  if (candidates.length) {
    await attachBases(candidates);
    return { word: cleaned, entries: candidates, fetchedAt: new Date().toISOString() };
  }

  // Rien du tout : dernier recours par le singulier. On n'invente aucune
  // definition, on cite celle du singulier reellement trouve et on annonce le
  // lien comme une hypothese, puisque le Wiktionnaire ne l'atteste pas.
  for (const singular of singulars(cleaned)) {
    const found = await collect(singular);
    if (!found.length) continue;
    // « QIS » vaut « pluriel de qi », pas « pluriel de QI (quotient
    // intellectuel) » : sous une forme flechie, les sigles ne sont que du bruit.
    const commonNouns = found.filter((entry) => entry.title[0] === entry.title[0].toLowerCase());
    const kept = commonNouns.length ? commonNouns : found;
    await attachBases(kept);
    return {
      word: cleaned,
      entries: kept.slice(0, 2).map((entry) => ({
        title: cleaned.toLowerCase(),
        kind: entry.kind,
        text: `Forme absente du Wiktionnaire ; vraisemblablement le pluriel de ${entry.title}.`,
        base: {
          title: entry.title,
          text: entry.base ? `${entry.text} — ${entry.base.title} : ${entry.base.text}` : entry.text,
        },
      })),
      fetchedAt: new Date().toISOString(),
    };
  }

  return { word: cleaned, entries: [], fetchedAt: new Date().toISOString() };
}

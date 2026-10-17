// Mini-serveur local : sert le site et enregistre les modifications des stuffs.
//
//   GET  /*                  fichiers statiques du projet
//   POST /api/save           enregistre { stuffs?, stock?, tags?, bank?, craft? } et l'ajoute à l'historique
//                            (log: "fabrication" -> historique de la fabrication ; label : nom de l'action)
//   PUT  /api/<partie>       idem pour une seule partie (stuffs, stock, tags, bank, craft)
//   GET  /api/history        entrées de l'historique (sans les états sauvegardés) ; ?log=fabrication
//   POST /api/history/undo   { id, log? } : annule cette entrée et toutes les suivantes
//   POST /api/folders        { action: create | update | delete, ... } : gestion des dossiers
// Les routes de données prennent ?dossier=<id> (par défaut : le premier dossier).
//
// Fichiers personnels, dans le dossier de données (data/ par défaut, voir lib/paths.js et config.json) ;
// le site les demande toujours sous data/ :
//   data/folders.js                 liste des dossiers { id, name, server }
//   data/folders/<id>/stuffs.js     personnages et stuffs du dossier
//   data/folders/<id>/stock.js      stock du dossier
//   data/folders/<id>/bank.js       export de la banque du dossier
//   data/folders/<id>/craft.js      liste de fabrication du dossier (exemplaires et compteurs de ressources)
//   data/folders/<id>/history.json  historique du dossier
//   data/folders/<id>/history-fabrication.json  historique de la fabrication
//   data/tags.js                    bibliothèque de tags (commune à tous les dossiers)
//   data/corbeille/                 dossiers supprimés
// Au démarrage, les données du jeu manquantes sont téléchargées depuis DofusDB (scripts/setup.js).
//
// Usage : npm start   (port 4310 par défaut, ou "port" dans config.json ; --ouvrir : ouvre le navigateur)
const fs = require('fs');
const http = require('http');
const path = require('path');
const history = require('./lib/history.js');
const paths = require('./lib/paths.js');
const { missingSteps, runSetup } = require('./scripts/setup.js');

const ROOT = __dirname;
const HOST = '127.0.0.1';
const { PORT, TAGS_PATH, FOLDERS_PATH, FOLDERS_DIR, TRASH_DIR } = paths;
// Dossier des données personnelles (anciennes données à sa racine, nouvelles dans folders/).
const DATA_DIR = paths.PERSONAL_DIR;
const FOLDER_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const EDITED_HEADER = 'Fichier modifié depuis le site (server.js)';
// Au-delà, les entrées les plus anciennes sont oubliées (et ne peuvent plus être annulées).
const HISTORY_LIMIT = 300;
const TAG_KINDS = ['trans', 'over', 'exo', 'removed'];
const STATUSES = ['missing', 'crafted', 'owned'];
const ITEMS_PATH = path.join(ROOT, 'data', 'dofus', 'items.json');
const COMMON_SPELLS_PATH = path.join(ROOT, 'data', 'dofus', 'common-spells.js');
const RECIPES_PATH = path.join(ROOT, 'data', 'dofus', 'recipes.js');
// Historiques d'un dossier : général, et celui de la fabrication (onglet à part).
const HISTORY_FILES = { general: 'history.json', fabrication: 'history-fabrication.json' };
const ICONS_DIR = path.join(ROOT, 'assets', 'items');
const DOFUSDB_IMG_URL = 'https://api.dofusdb.fr/img/items';
const MAX_BODY = 5 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('Requête trop volumineuse')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function validateStuffs(classes) {
  if (!Array.isArray(classes)) throw new Error('Liste de classes attendue');
  for (const cls of classes) {
    if (typeof cls.name !== 'string' || !Array.isArray(cls.stuffs)) throw new Error('Classe invalide');
    if (cls.commonSpells != null && (!Array.isArray(cls.commonSpells) || !cls.commonSpells.every(Number.isInteger))) {
      throw new Error(`Sorts communs invalides pour ${cls.name}`);
    }
    if (cls.scrolls != null) {
      if (typeof cls.scrolls !== 'object') throw new Error(`Parchottage invalide pour ${cls.name}`);
      for (const value of Object.values(cls.scrolls)) {
        if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error(`Parchottage invalide pour ${cls.name}`);
      }
    }
    for (const stuff of cls.stuffs) {
      if (!Array.isArray(stuff.items)) throw new Error(`Stuff invalide dans ${cls.name}`);
      for (const item of stuff.items) {
        if (typeof item.slot !== 'string' || !Array.isArray(item.variants)) throw new Error(`Emplacement invalide dans ${stuff.name}`);
      }
    }
  }
}

function validateBank(bank) {
  if (!bank || typeof bank !== 'object' || !Array.isArray(bank.entries)) throw new Error('Banque invalide');
  for (const entry of bank.entries) {
    if (typeof entry.key !== 'string' || !Array.isArray(entry.variants) || !Array.isArray(entry.holders)) {
      throw new Error('Entrée de banque invalide');
    }
  }
}

function validateStock(stock) {
  if (!Array.isArray(stock)) throw new Error('Liste du stock attendue');
  for (const entry of stock) {
    if (typeof entry.id !== 'string' || !Array.isArray(entry.variants) || !entry.variants.length || !Array.isArray(entry.bonuses)) {
      throw new Error('Objet du stock invalide');
    }
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1) throw new Error('Quantité invalide dans le stock');
    if (!STATUSES.includes(entry.status)) throw new Error('État invalide dans le stock');
    if (entry.owner != null && typeof entry.owner !== 'string') throw new Error('Propriétaire invalide dans le stock');
  }
}

// Fabrication : { copies: [{ id, itemId, seq, owner?, links: [{ cls, stuff, slot }] }], counters: { <ressource>: n }, seq }.
function validateCraft(craft) {
  if (!craft || typeof craft !== 'object' || !Array.isArray(craft.copies) || !craft.counters || typeof craft.counters !== 'object') {
    throw new Error('Liste de fabrication invalide');
  }
  for (const copy of craft.copies) {
    if (typeof copy.id !== 'string' || !Number.isInteger(copy.itemId) || !Array.isArray(copy.links)) throw new Error('Exemplaire de fabrication invalide');
    if (copy.owner != null && typeof copy.owner !== 'string') throw new Error('Personnage invalide dans la fabrication');
    for (const link of copy.links) {
      if (typeof link.stuff !== 'string' || typeof link.slot !== 'string') throw new Error('Lien de fabrication invalide');
    }
  }
  for (const [id, n] of Object.entries(craft.counters)) {
    if (!/^[0-9]+$/.test(id) || !Number.isInteger(n) || n < 0) throw new Error('Compteur de ressource invalide');
  }
}

function validateTags(tags) {
  if (!Array.isArray(tags)) throw new Error('Liste de tags attendue');
  for (const tag of tags) {
    if (!TAG_KINDS.includes(tag.kind) || typeof tag.text !== 'string' || !tag.text.trim()) throw new Error('Tag invalide');
  }
}

function writeWindowFile(file, varName, header, data) {
  const content = `// ${header} — ne pas modifier à la main.\n`
    + `window.${varName} = ${JSON.stringify(data, null, 2)};\n`;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, file);
}

// Télécharge les icônes manquantes des objets choisis depuis l'éditeur.
let iconIdsById = null;
async function downloadMissingIcons(classes) {
  if (!iconIdsById) {
    if (!fs.existsSync(ITEMS_PATH)) return;
    const { items } = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf-8'));
    iconIdsById = new Map(items.map((i) => [i.id, i.iconId]));
  }
  const iconIds = new Set();
  for (const cls of classes) for (const stuff of cls.stuffs) for (const item of stuff.items) {
    for (const v of item.variants) if (iconIdsById.has(v.itemId)) iconIds.add(iconIdsById.get(v.itemId));
  }
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  for (const iconId of iconIds) {
    const dest = path.join(ICONS_DIR, `${iconId}.png`);
    if (fs.existsSync(dest)) continue;
    try {
      const response = await fetch(`${DOFUSDB_IMG_URL}/${iconId}.png`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
      console.log(`  ✓ icône ${iconId}.png`);
    } catch (err) {
      console.error(`  ✗ icône ${iconId}.png: ${err.message}`);
    }
  }
}

// Parties enregistrables : variable globale, validation, en-tête. Les tags sont communs, le reste est par dossier.
const PARTS = {
  stuffs: { varName: 'STUFFS', validate: validateStuffs, header: EDITED_HEADER },
  stock: { varName: 'STOCK', validate: validateStock, header: EDITED_HEADER },
  tags: { varName: 'TAGS', validate: validateTags, header: EDITED_HEADER },
  bank: { varName: 'BANK', validate: validateBank, header: 'Fichier généré depuis le site (export des stuffs)' },
  craft: { varName: 'CRAFT', validate: validateCraft, header: EDITED_HEADER },
};
const EMPTY_CRAFT = { copies: [], counters: {}, seq: 0 };

// Noms des objets et des ressources (pour l'historique de la fabrication), lus une fois.
let gameNames = null;
function gameNamesContext() {
  if (!gameNames) {
    const itemNames = {};
    if (fs.existsSync(ITEMS_PATH)) JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf-8')).items.forEach((i) => { itemNames[i.id] = i.name; });
    const recipes = readWindowFile(RECIPES_PATH);
    const resourceNames = recipes ? Object.fromEntries(Object.entries(recipes.ingredients).map(([id, r]) => [id, r.name])) : {};
    gameNames = { itemNames, resourceNames };
  }
  return gameNames;
}

// Noms des paires de sorts communs (« Flamèche / Flamiche »), pour l'historique.
function spellPairNames() {
  const spells = readWindowFile(COMMON_SPELLS_PATH);
  return spells ? Object.fromEntries(spells.pairs.map((p) => [p.id, p.spells.map((s) => s.name).join(' / ')])) : {};
}

function readWindowFile(file) {
  if (!fs.existsSync(file)) return null;
  const source = fs.readFileSync(file, 'utf-8');
  return JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;$/, ''));
}

// --- Dossiers ------------------------------------------------------------------------------
function readFolders() {
  return readWindowFile(FOLDERS_PATH) || [];
}

function writeFolders(folders) {
  writeWindowFile(FOLDERS_PATH, 'FOLDERS', EDITED_HEADER, folders);
}

// Dossier demandé (?dossier=<id>), ou le premier par défaut.
function folderFor(req) {
  const folders = readFolders();
  const id = new URL(req.url, 'http://localhost').searchParams.get('dossier');
  const folder = id ? folders.find((f) => f.id === id) : folders[0];
  if (!folder || !FOLDER_ID.test(folder.id)) throw new Error('Dossier inconnu : ' + (id || '(aucun)'));
  return path.join(FOLDERS_DIR, folder.id);
}

function partFile(name, dir) {
  return name === 'tags' ? TAGS_PATH : path.join(dir, `${name}.js`);
}

function writeEmptyFolder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  writeWindowFile(partFile('stuffs', dir), 'STUFFS', EDITED_HEADER, []);
  writeWindowFile(partFile('stock', dir), 'STOCK', EDITED_HEADER, []);
  writeWindowFile(partFile('bank', dir), 'BANK', PARTS.bank.header, { exportedAt: new Date().toISOString(), entries: [] });
  writeWindowFile(partFile('craft', dir), 'CRAFT', EDITED_HEADER, EMPTY_CRAFT);
}

// Premier démarrage : un premier dossier vide, ou les anciennes données (data/stuffs.js…) rangées dans un dossier.
function migrateToFolders() {
  if (fs.existsSync(FOLDERS_PATH)) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(path.join(DATA_DIR, 'stuffs.js'))) {
    writeEmptyFolder(path.join(FOLDERS_DIR, 'principal'));
    writeFolders([{ id: 'principal', name: 'Principal', server: '' }]);
    console.log(`📁 Nouvelle installation : dossier « Principal » créé dans ${DATA_DIR}`);
    return;
  }
  const id = 'tylezia';
  const dir = path.join(FOLDERS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  ['stuffs.js', 'stock.js', 'bank.js', 'history.json'].forEach((name) => {
    if (fs.existsSync(path.join(DATA_DIR, name))) fs.renameSync(path.join(DATA_DIR, name), path.join(dir, name));
  });
  if (!fs.existsSync(partFile('stock', dir))) writeWindowFile(partFile('stock', dir), 'STOCK', EDITED_HEADER, []);
  writeFolders([{ id, name: 'Tylezia', server: 'Tylezia' }]);
  console.log('📁 Données rangées dans le dossier « Tylezia » (data/folders/tylezia/)');
}

// Pas encore de bibliothèque de tags : celle par défaut du projet (data/defaults/tags.js).
function ensureTags() {
  if (fs.existsSync(TAGS_PATH)) return;
  const defaults = readWindowFile(paths.DEFAULT_TAGS_PATH) || [];
  writeWindowFile(TAGS_PATH, 'TAGS', EDITED_HEADER, defaults);
  console.log(`🏷️  Bibliothèque de tags par défaut copiée (${defaults.length} tags)`);
}

function slugify(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'dossier';
}

function validateFolderInfo({ name, server }) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) throw new Error('Nom de dossier invalide');
  if (server != null && (typeof server !== 'string' || server.trim().length > 40)) throw new Error('Nom de serveur invalide');
  return { name: name.trim(), server: (server || '').trim() };
}

function handleFolders(body) {
  const folders = readFolders();
  if (body.action === 'create') {
    const info = validateFolderInfo(body);
    const base = slugify(info.name);
    let id = base;
    for (let n = 2; folders.some((f) => f.id === id) || fs.existsSync(path.join(FOLDERS_DIR, id)); n++) id = `${base}-${n}`;
    writeEmptyFolder(path.join(FOLDERS_DIR, id));
    folders.push({ id, ...info });
    writeFolders(folders);
    console.log(`📁 Dossier « ${info.name} » créé`);
    return { id };
  }
  const folder = folders.find((f) => f.id === body.id);
  if (!folder) throw new Error('Dossier introuvable');
  if (body.action === 'update') {
    Object.assign(folder, validateFolderInfo(body));
    writeFolders(folders);
    return { id: folder.id };
  }
  if (body.action === 'delete') {
    if (folders.length === 1) throw new Error('Impossible de supprimer le dernier dossier');
    // Pas de suppression définitive : le dossier part dans la corbeille.
    fs.mkdirSync(TRASH_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(path.join(FOLDERS_DIR, folder.id), path.join(TRASH_DIR, `${folder.id}-${stamp}`));
    writeFolders(folders.filter((f) => f !== folder));
    console.log(`🗑️  Dossier « ${folder.name} » déplacé dans data/corbeille/`);
    return { id: folder.id };
  }
  throw new Error('Action inconnue');
}

async function handleFoldersRequest(req, res) {
  try {
    send(res, 200, { ok: true, ...handleFolders(JSON.parse(await readBody(req))) });
  } catch (err) {
    send(res, 400, { ok: false, error: err.message });
  }
}

// --- Historique (par dossier) -----------------------------------------------------------------
function historyFile(dir, log) {
  return path.join(dir, HISTORY_FILES[log] || HISTORY_FILES.general);
}

function readHistory(dir, log) {
  const file = historyFile(dir, log);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [];
}

function writeHistory(dir, entries, log) {
  const file = historyFile(dir, log);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries.slice(-HISTORY_LIMIT)), 'utf-8');
  fs.renameSync(tmp, file);
}

// Enregistre les parties reçues ; stuffs / stock / tags / craft sont ajoutés à l'historique du dossier
// (celui de la fabrication si data.log === "fabrication").
function save(dir, data) {
  const names = Object.keys(data).filter((name) => PARTS[name]);
  if (!names.length) throw new Error('Rien à enregistrer');
  names.forEach((name) => PARTS[name].validate(data[name]));

  const previous = {};
  ['stuffs', 'stock', 'tags', 'craft'].filter((name) => data[name]).forEach((name) => { previous[name] = readWindowFile(partFile(name, dir)); });
  const classes = data.stuffs || readWindowFile(partFile('stuffs', dir)) || [];
  const context = {
    classNames: Object.fromEntries(classes.map((c) => [c.id, c.name])),
    stuffNames: Object.fromEntries(classes.flatMap((c) => c.stuffs.filter((s) => s.id).map((s) => [s.id, s.name]))),
    spellPairs: spellPairNames(),
    ...gameNamesContext(),
    label: typeof data.label === 'string' && data.label ? data.label.slice(0, 200) : null,
  };
  const log = data.log === 'fabrication' ? 'fabrication' : 'general';
  writeHistory(dir, history.record(readHistory(dir, log), previous, data, Date.now(), context), log);

  names.forEach((name) => writeWindowFile(partFile(name, dir), PARTS[name].varName, PARTS[name].header, data[name]));
  console.log(`💾 ${path.basename(dir)} : ${names.join(', ')} enregistré (${new Date().toLocaleTimeString('fr-FR')})`);

  const withIcons = [...(data.stuffs || []), { stuffs: [{ items: data.stock || [] }] }];
  downloadMissingIcons(withIcons).catch((err) => console.error('Icônes:', err.message));
}

async function handleSave(req, res, part) {
  try {
    const dir = folderFor(req);
    const body = JSON.parse(await readBody(req));
    save(dir, part ? { [part]: body } : body);
    send(res, 200, { ok: true });
  } catch (err) {
    send(res, 400, { ok: false, error: err.message });
  }
}

function handleHistory(req, res) {
  try {
    // Les états avant / après restent sur le serveur : seules les descriptions sont envoyées.
    const log = new URL(req.url, 'http://localhost').searchParams.get('log');
    const entries = readHistory(folderFor(req), log).map(({ id, at, changes }) => ({ id, at, changes })).reverse();
    send(res, 200, { ok: true, entries });
  } catch (err) {
    send(res, 400, { ok: false, error: err.message });
  }
}

async function handleUndo(req, res) {
  try {
    const dir = folderFor(req);
    const { id, log } = JSON.parse(await readBody(req));
    const entries = readHistory(dir, log);
    const state = {
      stuffs: readWindowFile(partFile('stuffs', dir)) || [],
      stock: readWindowFile(partFile('stock', dir)) || [],
      tags: readWindowFile(TAGS_PATH) || [],
      craft: readWindowFile(partFile('craft', dir)) || JSON.parse(JSON.stringify(EMPTY_CRAFT)),
    };
    const count = history.undo(entries, id, state);
    if (!count) throw new Error('Entrée introuvable dans l\'historique');
    ['stuffs', 'stock', 'tags', 'craft'].forEach((name) => writeWindowFile(partFile(name, dir), PARTS[name].varName, PARTS[name].header, state[name]));
    writeHistory(dir, entries, log);
    console.log(`↩️  ${path.basename(dir)} : ${count} modification(s) annulée(s) (${new Date().toLocaleTimeString('fr-FR')})`);
    send(res, 200, { ok: true, count });
  } catch (err) {
    send(res, 400, { ok: false, error: err.message });
  }
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  // Fichiers personnels (data/folders.js, data/tags.js, data/folders/…) : depuis le dossier de données.
  const personal = paths.PERSONAL_URLS.some((u) => (u.endsWith('/') ? urlPath.startsWith(u) : urlPath === u));
  const base = personal ? DATA_DIR : ROOT;
  let file = path.normalize(path.join(base, personal ? urlPath.slice('/data'.length) : urlPath));
  if (file !== base && !file.startsWith(base + path.sep)) return send(res, 403, 'Interdit', 'text/plain; charset=utf-8');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Introuvable', 'text/plain; charset=utf-8');
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  if (route === '/api/save' && req.method === 'POST') return handleSave(req, res);
  const part = route.match(/^\/api\/(stuffs|stock|tags|bank)$/);
  if (part && req.method === 'PUT') return handleSave(req, res, part[1]);
  if (route === '/api/history' && req.method === 'GET') return handleHistory(req, res);
  if (route === '/api/history/undo' && req.method === 'POST') return handleUndo(req, res);
  if (route === '/api/folders' && req.method === 'POST') return handleFoldersRequest(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  send(res, 405, { ok: false, error: 'Méthode non autorisée' });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Le port ${PORT} est déjà utilisé : le site est peut-être déjà ouvert dans une autre fenêtre (http://${HOST}:${PORT}),`);
    console.error('   sinon un autre programme utilise ce port. Pour en changer, créer config.json à côté de server.js :');
    console.error('     { "port": 4311 }');
  } else {
    console.error('❌ Erreur serveur :', err.message);
  }
  process.exit(1);
});

// Ouvre l'adresse dans le navigateur par défaut.
function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  require('child_process').spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

async function start() {
  // fetch (téléchargements DofusDB) : Node.js 18 ou plus.
  if (Number(process.versions.node.split('.')[0]) < 18) {
    console.error(`❌ Node.js ${process.versions.node} est trop ancien : installer la version LTS depuis https://nodejs.org`);
    process.exit(1);
  }
  migrateToFolders();
  ensureTags();
  // Dossiers créés avant la fabrication : liste vide.
  readFolders().filter((f) => FOLDER_ID.test(f.id)).forEach((f) => {
    const file = partFile('craft', path.join(FOLDERS_DIR, f.id));
    if (fs.existsSync(path.dirname(file)) && !fs.existsSync(file)) writeWindowFile(file, 'CRAFT', EDITED_HEADER, EMPTY_CRAFT);
  });
  if (DATA_DIR !== path.join(ROOT, 'data')) console.log(`📁 Données personnelles : ${DATA_DIR}`);
  // Données du jeu absentes (nouvelle installation) : téléchargées avant d'ouvrir le site.
  if (missingSteps().length) await runSetup();

  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(`\n✅ Site disponible sur ${url}`);
    console.log('   (Ctrl+C ou fermer cette fenêtre pour arrêter)');
    if (process.argv.includes('--ouvrir')) openBrowser(url);
  });
}

start().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});

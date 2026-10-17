// Relie les objets des stuffs (tous les dossiers) aux objets DofusDB (data/dofus/items.json)
// et télécharge leurs icônes dans assets/items/.
//
// Génère data/item-icons.js : { "<nom dans le tableau>": { id, name, level, typeId, icon } }.
// Les noms qui ne correspondent pas exactement au jeu se corrigent dans data/item-aliases.json.
//
// Usage : node scripts/fetchItemIcons.js   (après node scripts/fetchItems.js)
const fs = require('fs');
const path = require('path');

const DOFUSDB_BASE_URL = 'https://api.dofusdb.fr';
const ROOT = path.join(__dirname, '..');
const ITEMS_PATH = path.join(ROOT, 'data', 'dofus', 'items.json');
const ALIASES_PATH = path.join(ROOT, 'data', 'item-aliases.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'item-icons.js');
const ICONS_DIR = path.join(ROOT, 'assets', 'items');

// typeIds attendus par emplacement, pour départager les homonymes.
const { slotTypes } = require('../js/slots.js');
const { readWindowVar, listFolders } = require('../lib/folders.js');

function normalize(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : fallback;
}

// Personnages de tous les dossiers.
function readStuffs() {
  return listFolders(ROOT).flatMap((folder) => readWindowVar(path.join(folder.dir, 'stuffs.js')) || []);
}

async function downloadImage(url, dest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

async function main() {
  if (!fs.existsSync(ITEMS_PATH)) {
    console.error(`Fichier introuvable: ${path.relative(ROOT, ITEMS_PATH)}`);
    console.error('Générer d\'abord les données avec: npm run fetch:items');
    process.exit(1);
  }

  const { items } = readJson(ITEMS_PATH);
  const aliases = readJson(ALIASES_PATH, {});
  const byName = new Map();
  for (const item of items) {
    const key = normalize(item.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(item);
  }

  // Noms du tableau, avec les emplacements où ils apparaissent.
  const wanted = new Map();
  for (const cls of readStuffs()) {
    for (const stuff of cls.stuffs) {
      for (const { slot, variants } of stuff.items) {
        for (const variant of variants) {
          if (!variant.name) continue;
          if (!wanted.has(variant.name)) wanted.set(variant.name, new Set());
          wanted.get(variant.name).add(slot);
        }
      }
    }
  }

  const links = {};
  const missing = [];
  for (const [name, slots] of wanted) {
    const target = aliases[name] ?? name;
    const candidates = byName.get(normalize(target)) ?? [];
    const types = [...slots].flatMap(slotTypes);
    // Homonymes du même type (ex. Crocobur niv. 100 et niv. 200 légendaire) : le plus haut niveau.
    const byLevel = [...candidates].sort((a, b) => b.level - a.level);
    const item = byLevel.find((c) => types.includes(c.typeId)) ?? byLevel[0];
    if (!item) { missing.push(`${name} (${[...slots].join(', ')})`); continue; }
    links[name] = {
      id: item.id,
      name: item.name,
      level: item.level,
      typeId: item.typeId,
      icon: `assets/items/${item.iconId}.png`,
      img: item.img ?? `${DOFUSDB_BASE_URL}/img/items/${item.iconId}.png`,
    };
  }

  fs.mkdirSync(ICONS_DIR, { recursive: true });
  const toDownload = new Map(Object.values(links).map((l) => [l.icon, l.img]));
  console.log(`📥 ${toDownload.size} icônes pour ${Object.keys(links).length}/${wanted.size} objets du tableau...`);

  let downloaded = 0;
  let skipped = 0;
  let errors = 0;
  for (const [icon, url] of toDownload) {
    const dest = path.join(ROOT, icon);
    if (fs.existsSync(dest)) { skipped++; continue; }
    try {
      await downloadImage(url, dest);
      downloaded++;
    } catch (err) {
      console.error(`  ✗ ${path.basename(icon)}: ${err.message}`);
      errors++;
    }
  }

  for (const link of Object.values(links)) delete link.img;
  fs.writeFileSync(
    OUTPUT_PATH,
    '// Fichier généré par scripts/fetchItemIcons.js — ne pas modifier à la main.\n'
      + `window.ITEM_ICONS = ${JSON.stringify(links, null, 2)};\n`,
    'utf-8',
  );

  console.log(`✅ Terminé — ${downloaded} téléchargées, ${skipped} déjà présentes, ${errors} erreurs`);
  console.log('   Dossier: assets/items/ — liens: data/item-icons.js');
  if (missing.length) {
    console.log(`\n⚠️  ${missing.length} objets non trouvés (à corriger dans data/item-aliases.json) :`);
    missing.forEach((m) => console.log(`   - ${m}`));
  }
}

main();

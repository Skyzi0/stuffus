// Exporte la banque d'objets (bank.js) de chaque dossier à partir de ses stuffs (stuffs.js).
// Les règles de regroupement sont dans js/bank-build.js.
//
// Usage : node scripts/buildBank.js [--dossier <id>] [--force]
//   --dossier : un seul dossier (par défaut : tous)
//   --force   : écrase aussi une banque modifiée depuis le site.
const fs = require('fs');
const path = require('path');
const { buildBank } = require('../js/bank-build.js');
const { readWindowVar, selectFolders } = require('../lib/folders.js');

const ROOT = path.join(__dirname, '..');
const ICONS_PATH = path.join(ROOT, 'data', 'item-icons.js');
const ITEMS_PATH = path.join(ROOT, 'data', 'dofus', 'items.json');
// Présent dans l'en-tête de bank.js quand la banque a été éditée depuis le site.
const EDITED_MARKER = 'modifiée depuis le site';

function exportFolder(folder, context) {
  const output = path.join(folder.dir, 'bank.js');
  const label = path.relative(ROOT, output);
  if (fs.existsSync(output) && fs.readFileSync(output, 'utf-8').includes(EDITED_MARKER) && !process.argv.includes('--force')) {
    console.error(`${label} a été modifiée depuis le site : l'export écraserait ces modifications (--force pour repartir des stuffs).`);
    return false;
  }

  const classes = readWindowVar(path.join(folder.dir, 'stuffs.js')) || [];
  const entries = buildBank(classes, context);
  const bank = { exportedAt: new Date().toISOString(), entries };
  fs.writeFileSync(
    output,
    '// Fichier généré par scripts/buildBank.js — ne pas modifier à la main.\n'
      + `window.BANK = ${JSON.stringify(bank, null, 2)};\n`,
    'utf-8',
  );

  const total = entries.reduce((n, e) => n + e.quantity, 0);
  const owned = entries.reduce((n, e) => n + e.owned, 0);
  const crafted = entries.reduce((n, e) => n + e.crafted, 0);
  console.log(`✅ ${folder.name} : ${total} objets (${entries.length} différents), ${owned} possédés, ${crafted} fabriqués -> ${label}`);
  return true;
}

function main() {
  const iconLinks = readWindowVar(ICONS_PATH) || {};
  const items = fs.existsSync(ITEMS_PATH) ? JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf-8')).items : [];
  const context = { itemsById: new Map(items.map((i) => [i.id, i])), iconLinks };

  let folders;
  try {
    folders = selectFolders(ROOT, process.argv);
  } catch (err) {
    console.error('❌ ' + err.message);
    process.exit(1);
  }
  const results = folders.map((folder) => exportFolder(folder, context));
  if (results.includes(false)) process.exit(1);
}

main();

const fs = require('fs');
const path = require('path');

const DOFUSDB_BASE_URL = 'https://api.dofusdb.fr';
const LIMIT = 50;
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'dofus', 'items.json');
// Version allégée chargée par le site (liste déroulante de l'éditeur).
const OUTPUT_JS_PATH = path.join(__dirname, '..', 'data', 'dofus', 'items.js');

// Configurer ici les typeId à récupérer
// Liste :
//   1 = Amulette        2 = Arc             3 = Baguette
//   4 = Bâton           5 = Dagues          6 = Épée
//   7 = Marteau         8 = Pelle           9 = Anneau
//   10 = Ceinture       11 = Bottes         16 = Chapeau
//   17 = Cape           18 = Familier       19 = Hache
//   22 = Faux           23 = Dofus          82 = Bouclier
//   121 = Montilier     151 = Trophée       217 = Prysmaradite
//   271 = Lance         331 = Dragodinde    332 = Muldo
//   333 = Volkorne
const TYPE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 22, 23, 82, 121, 151, 217, 271, 331, 332, 333];

function extractItem(item) {
  return {
    id: item.id,
    name: item.name?.fr ?? '',
    level: item.level ?? 0,
    typeId: item.typeId,
    iconId: item.iconId,
    itemSetId: item.itemSetId > 0 ? item.itemSetId : null,
    isLegendary: !!item.isLegendary,
    img: item.img ?? null,
  };
}

async function fetchByTypeId(typeId) {
  let skip = 0;
  let total = Infinity;
  const items = [];

  while (skip < total) {
    const params = new URLSearchParams();
    params.append('typeId', String(typeId));
    params.append('$limit', String(LIMIT));
    params.append('$skip', String(skip));
    const url = `${DOFUSDB_BASE_URL}/items?${params.toString()}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Erreur API: ${response.status} sur ${url}`);

    const data = await response.json();
    total = data.total;
    for (const item of data.data) items.push(extractItem(item));
    skip += LIMIT;
  }

  return items;
}

async function fetchAllItems() {
  const allItems = [];

  for (let i = 0; i < TYPE_IDS.length; i++) {
    const typeId = TYPE_IDS[i];
    process.stdout.write(`\r  [${i + 1}/${TYPE_IDS.length}] typeId ${typeId}...          `);
    const items = await fetchByTypeId(typeId);
    allItems.push(...items);
  }

  process.stdout.write('\n');
  return allItems;
}

async function main() {
  console.log(`Recuperation des objets (typeIds: ${TYPE_IDS.join(', ')}) depuis DofusDB...`);

  try {
    const items = await fetchAllItems();

    const output = {
      total: items.length,
      typeIds: TYPE_IDS,
      fetchedAt: new Date().toISOString(),
      items,
    };

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

    // « legendary » n'est écrit que pour les objets légendaires, pour garder le fichier léger.
    const compact = items.map(({ id, name, level, typeId, iconId, isLegendary }) => (
      isLegendary ? { id, name, level, typeId, iconId, legendary: true } : { id, name, level, typeId, iconId }
    ));
    fs.writeFileSync(
      OUTPUT_JS_PATH,
      '// Fichier généré par scripts/fetchItems.js — ne pas modifier à la main.\n'
        + `window.DOFUS_ITEMS = ${JSON.stringify(compact)};\n`,
      'utf-8',
    );

    console.log(`${items.length} objets sauvegardes dans: data/dofus/items.json (+ items.js pour le site)`);
    console.log(`Recupere le: ${output.fetchedAt}`);
  } catch (error) {
    console.error('Erreur:', error.message);
    process.exit(1);
  }
}

main();

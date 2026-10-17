const fs = require('fs');
const path = require('path');

const DOFUSDB_BASE_URL = 'https://api.dofusdb.fr';
const LIMIT = 50;
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'dofus', 'item-sets.json');

function extractBonus(effects) {
  return effects.map((e) => ({
    effectId: e.effectId,
    diceNum: e.diceNum,
    diceSide: e.diceSide,
    value: e.value,
  }));
}

function extractSet(set) {
  return {
    id: set.id,
    name: set.name?.fr ?? '',
    level: set.level ?? 0,
    items: (set.items ?? []).map((item) => ({
      id: item.id,
      iconId: item.iconId,
      typeId: item.typeId,
      level: item.level ?? 0,
      name: item.name?.fr ?? '',
    })),
    bonuses: (set.possibleEffects ?? []).map((effects) => extractBonus(effects)),
  };
}

async function fetchAllItemSets() {
  let skip = 0;
  let total = Infinity;
  const sets = [];

  while (skip < total) {
    const url = `${DOFUSDB_BASE_URL}/item-sets?isCosmetic=false&%24limit=${LIMIT}&%24skip=${skip}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Erreur API: ${response.status} sur ${url}`);
    }

    const data = await response.json();
    total = data.total;

    for (const set of data.data) {
      sets.push(extractSet(set));
    }

    skip += LIMIT;
    process.stdout.write(`\r  Progression: ${Math.min(skip, total)}/${total}`);
  }

  process.stdout.write('\n');
  return sets;
}

async function main() {
  console.log('📊 Récupération des panoplies classiques depuis DofusDB...');

  try {
    const sets = await fetchAllItemSets();

    const output = {
      total: sets.length,
      fetchedAt: new Date().toISOString(),
      sets,
    };

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

    console.log(`✅ ${sets.length} panoplies sauvegardées dans: data/dofus/item-sets.json`);
    console.log(`   Récupéré le: ${output.fetchedAt}`);
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

main();

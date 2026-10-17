// Récupère les sorts communs (breedId 19) depuis DofusDB et télécharge leurs icônes.
// Écrit data/dofus/common-spells.js : window.COMMON_SPELLS = { breedId, fetchedAt, pairs: [{ id, spells: [...] }] }.
// Chaque paire regroupe un sort et sa variante (débloquer l'un débloque l'autre) ; pour chaque sort,
// seuls son nom, son niveau d'obtention et son icône sont gardés.
const fs = require('fs');
const path = require('path');

const API = 'https://api.dofusdb.fr';
const BREED_ID = 19;
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'dofus', 'common-spells.js');
const ICONS_DIR = path.join(ROOT, 'assets', 'spells');
// Sorts non obtenables, écartés de la liste : Ankatchoum de vague / de combat.
const EXCLUDED_SPELL_IDS = new Set([25122, 25201]);

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erreur API ${res.status} sur ${url}`);
  return res.json();
}

// Niveau d'obtention : celui du premier grade du sort.
async function fetchLevel(spellId) {
  const { data } = await getJson(`${API}/spell-levels?spellId=${spellId}&$limit=50`);
  return data.reduce((min, level) => Math.min(min, level.minPlayerLevel), Infinity);
}

async function downloadIcon(spell) {
  const file = path.join(ICONS_DIR, `${spell.iconId}.png`);
  if (fs.existsSync(file)) return false;
  const res = await fetch(spell.img || `${API}/img/spells/sort_${spell.iconId}.png`);
  if (!res.ok) {
    console.warn(`  ⚠ Icône introuvable pour ${spell.name.fr} (${res.status})`);
    return false;
  }
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function main() {
  console.log(`Récupération des sorts communs (breedId ${BREED_ID}) depuis DofusDB...`);
  const { data: variants } = await getJson(`${API}/spell-variants?breedId=${BREED_ID}&$limit=50`);

  const pairs = [];
  let downloaded = 0;
  for (const variant of variants.sort((a, b) => a.id - b.id)) {
    if ((variant.spells || []).some((spell) => EXCLUDED_SPELL_IDS.has(spell.id))) continue;
    const spells = [];
    for (const spell of variant.spells || []) {
      spells.push({
        id: spell.id,
        name: spell.name.fr,
        level: await fetchLevel(spell.id),
        icon: `assets/spells/${spell.iconId}.png`,
      });
      if (await downloadIcon(spell)) downloaded++;
    }
    pairs.push({ id: variant.id, spells });
    console.log(`  📖 ${spells.map((s) => `${s.name} (niv. ${s.level})`).join(' / ')}`);
  }
  // Par niveau d'obtention.
  pairs.sort((a, b) => a.spells[0].level - b.spells[0].level || a.spells[0].name.localeCompare(b.spells[0].name, 'fr'));

  const data = { breedId: BREED_ID, fetchedAt: new Date().toISOString(), pairs };
  fs.writeFileSync(OUT, '// Fichier généré par scripts/fetchCommonSpells.js — ne pas modifier à la main.\n'
    + `window.COMMON_SPELLS = ${JSON.stringify(data, null, 2)};\n`, 'utf-8');
  const count = pairs.reduce((n, p) => n + p.spells.length, 0);
  console.log(`✅ ${pairs.length} paires (${count} sorts) enregistrées dans data/dofus/common-spells.js — ${downloaded} icône(s) téléchargée(s)`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });

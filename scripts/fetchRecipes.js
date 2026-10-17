// Récupère les recettes des objets de data/dofus/items.json depuis DofusDB et télécharge les icônes
// des ingrédients et des métiers.
// Écrit data/dofus/recipes.js : window.DOFUS_RECIPES = {
//   fetchedAt,
//   jobs:        { <jobId>: { name, icon } },
//   ingredients: { <itemId>: { name, level, typeId, type, icon } },
//   recipes:     { <itemId de l'objet fabriqué>: { jobId, ingredients: [[itemId, quantité], ...] } },
// }
const fs = require('fs');
const path = require('path');

const API = 'https://api.dofusdb.fr';
const LIMIT = 50;
const ROOT = path.join(__dirname, '..');
const ITEMS_PATH = path.join(ROOT, 'data', 'dofus', 'items.json');
const OUT = path.join(ROOT, 'data', 'dofus', 'recipes.js');
const ITEM_ICONS_DIR = path.join(ROOT, 'assets', 'items');
const JOB_ICONS_DIR = path.join(ROOT, 'assets', 'jobs');
const DOWNLOADS_IN_PARALLEL = 8;

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Erreur API ${res.status} sur ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// Toutes les recettes dont le résultat est de ce type d'objet.
async function fetchRecipesOfType(typeId) {
  const recipes = [];
  let total = Infinity;
  for (let skip = 0; skip < total; skip += LIMIT) {
    const data = await getJson(`${API}/recipes?resultTypeId=${typeId}&$limit=${LIMIT}&$skip=${skip}`);
    total = data.total;
    recipes.push(...data.data);
  }
  return recipes;
}

async function download(url, file) {
  if (fs.existsSync(file)) return false;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

// Téléchargements en parallèle, par petits groupes.
async function downloadAll(list, label) {
  let done = 0;
  let downloaded = 0;
  let failed = 0;
  const queue = [...list];
  const worker = async () => {
    while (queue.length) {
      const { url, file } = queue.shift();
      try {
        if (await download(url, file)) downloaded++;
      } catch (err) {
        failed++;
        console.warn(`\n  ⚠ ${path.basename(file)} : ${err.message}`);
      }
      process.stdout.write(`\r  ${label} : ${++done}/${list.length}          `);
    }
  };
  await Promise.all(Array.from({ length: DOWNLOADS_IN_PARALLEL }, worker));
  process.stdout.write('\n');
  return { downloaded, failed };
}

async function main() {
  if (!fs.existsSync(ITEMS_PATH)) throw new Error('data/dofus/items.json introuvable : lancer d\'abord « npm run fetch:items »');
  const { items } = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf-8'));
  const itemIds = new Set(items.map((i) => i.id));
  const typeIds = [...new Set(items.map((i) => i.typeId))].sort((a, b) => a - b);

  console.log(`Récupération des recettes (${typeIds.length} types d'objets) depuis DofusDB...`);
  const recipes = {};
  const jobs = {};
  const ingredients = {};
  for (let i = 0; i < typeIds.length; i++) {
    process.stdout.write(`\r  [${i + 1}/${typeIds.length}] typeId ${typeIds[i]}...          `);
    for (const recipe of await fetchRecipesOfType(typeIds[i])) {
      // Seulement les objets suivis (items.json).
      if (!itemIds.has(recipe.resultId)) continue;
      recipes[recipe.resultId] = {
        jobId: recipe.jobId,
        ingredients: recipe.ingredientIds.map((id, k) => [id, recipe.quantities[k]]),
      };
      if (recipe.job && !jobs[recipe.jobId]) {
        // L'adresse « img » de DofusDB (.jpg) n'existe pas : l'icône est en .png, par son iconId.
        jobs[recipe.jobId] = { name: recipe.job.name.fr, icon: `assets/jobs/${recipe.jobId}.png`, img: `${API}/img/jobs/${recipe.job.iconId}.png` };
      }
      for (const ing of recipe.ingredients || []) {
        if (ingredients[ing.id]) continue;
        ingredients[ing.id] = {
          name: ing.name.fr,
          level: ing.level,
          typeId: ing.typeId,
          type: ing.type && ing.type.name ? ing.type.name.fr : '',
          icon: `assets/items/${ing.iconId}.png`,
          iconId: ing.iconId,
        };
      }
    }
  }
  process.stdout.write('\n');

  // Icônes des ingrédients et des métiers.
  fs.mkdirSync(ITEM_ICONS_DIR, { recursive: true });
  fs.mkdirSync(JOB_ICONS_DIR, { recursive: true });
  const iconIds = [...new Set(Object.values(ingredients).map((i) => i.iconId))];
  const itemIcons = await downloadAll(iconIds.map((id) => ({ url: `${API}/img/items/${id}.png`, file: path.join(ITEM_ICONS_DIR, `${id}.png`) })), 'icônes des ingrédients');
  const jobIcons = await downloadAll(Object.entries(jobs).filter(([, j]) => j.img).map(([id, j]) => ({ url: j.img, file: path.join(JOB_ICONS_DIR, `${id}.png`) })), 'icônes des métiers');

  Object.values(ingredients).forEach((i) => { delete i.iconId; });
  Object.values(jobs).forEach((j) => { delete j.img; });
  const data = { fetchedAt: new Date().toISOString(), jobs, ingredients, recipes };
  fs.writeFileSync(OUT, '// Fichier généré par scripts/fetchRecipes.js — ne pas modifier à la main.\n'
    + `window.DOFUS_RECIPES = ${JSON.stringify(data)};\n`, 'utf-8');

  const size = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`✅ ${Object.keys(recipes).length} recettes sur ${items.length} objets, ${Object.keys(ingredients).length} ingrédients, `
    + `${Object.keys(jobs).length} métiers → data/dofus/recipes.js (${size} Ko)`);
  console.log(`   Icônes : ${itemIcons.downloaded} ingrédient(s) et ${jobIcons.downloaded} métier(s) téléchargés`
    + (itemIcons.failed + jobIcons.failed ? `, ${itemIcons.failed + jobIcons.failed} échec(s)` : ''));
}

main().catch((err) => { console.error('\n' + err.message); process.exit(1); });

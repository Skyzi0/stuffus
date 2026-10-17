// Données du jeu d'une installation, téléchargées depuis DofusDB (elles ne sont pas distribuées avec le projet) :
// objets, panoplies, recettes (ressources et métiers) et icônes.
//
//   npm run setup          télécharge ce qui manque (fait automatiquement au démarrage du serveur)
//   npm run update-data    retélécharge tout (après une mise à jour du jeu)
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, GAME_DIR } = require('../lib/paths.js');

// Dans l'ordre : les recettes et les icônes ont besoin de la liste des objets.
const STEPS = [
  { label: 'Objets', script: 'fetchItems.js', outputs: [path.join(GAME_DIR, 'items.json'), path.join(GAME_DIR, 'items.js')] },
  { label: 'Panoplies', script: 'fetchItemSets.js', outputs: [path.join(GAME_DIR, 'item-sets.json')] },
  { label: 'Recettes, ressources et métiers (avec leurs icônes)', script: 'fetchRecipes.js', outputs: [path.join(GAME_DIR, 'recipes.js')] },
  { label: 'Icônes des objets des stuffs', script: 'fetchItemIcons.js', outputs: [path.join(ROOT, 'data', 'item-icons.js')] },
];

function missingSteps() {
  return STEPS.filter((step) => step.outputs.some((file) => !fs.existsSync(file)));
}

function runScript(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], { cwd: ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} s'est arrêté (code ${code})`))));
  });
}

// force : tout retélécharger. Retourne la liste des étapes en échec (vide si tout s'est bien passé).
async function runSetup({ force = false } = {}) {
  const steps = force ? STEPS : missingSteps();
  if (!steps.length) return [];
  console.log(`\n📦 Téléchargement des données du jeu depuis DofusDB (${steps.length} étape${steps.length > 1 ? 's' : ''}, quelques minutes la première fois)…`);
  const failed = [];
  for (const [i, step] of steps.entries()) {
    console.log(`\n── ${i + 1}/${steps.length} · ${step.label}`);
    try {
      await runScript(step.script);
    } catch (err) {
      console.error(`⚠️  ${step.label} : ${err.message}`);
      failed.push(step);
    }
  }
  if (failed.length) {
    console.error(`\n⚠️  Données incomplètes (${failed.map((s) => s.label).join(', ')}).`);
    console.error('   Vérifier la connexion à Internet puis relancer : npm run setup');
  } else {
    console.log('\n✅ Données du jeu prêtes.');
  }
  return failed;
}

module.exports = { missingSteps, runSetup };

if (require.main === module) {
  runSetup({ force: process.argv.includes('--force') })
    .then((failed) => process.exit(failed.length ? 1 : 0))
    .catch((err) => { console.error(err.message); process.exit(1); });
}

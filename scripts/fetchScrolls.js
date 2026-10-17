// Récupère les parchemins de caractéristiques (typeId 76) depuis DofusDB et télécharge leurs icônes.
// Écrit data/dofus/scrolls.js : window.DOFUS_SCROLLS = { <stat>: { small, medium, large, powerful } }.
const fs = require('fs');
const path = require('path');

const API = 'https://api.dofusdb.fr';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'dofus', 'scrolls.js');
// Distribuées avec le projet (à part des icônes d'objets, téléchargées sur chaque installation).
const ICONS_DIR = path.join(ROOT, 'assets', 'scrolls');

// Identifiant de caractéristique DofusDB (effet du parchemin) → statistique du parchottage.
const STATS = { 11: 'vitality', 10: 'strength', 15: 'intelligence', 13: 'chance', 14: 'agility', 12: 'wisdom' };

function tierOf(name) {
  if (name.startsWith('Petit ')) return 'small';
  if (name.startsWith('Grand ')) return 'large';
  if (name.startsWith('Puissant ')) return 'powerful';
  return 'medium';
}

async function main() {
  const res = await fetch(`${API}/items?typeId=76&$limit=50&lang=fr`);
  if (!res.ok) throw new Error(`Erreur API: ${res.status}`);
  const { data } = await res.json();

  const scrolls = {};
  for (const item of data) {
    const effects = item.effects || [];
    // Un parchemin de caractéristique n'a qu'un effet (le « Parchemin accélérant » en a six : ignoré).
    if (effects.length !== 1 || !STATS[effects[0].characteristic]) continue;
    const stat = STATS[effects[0].characteristic];
    const icon = `assets/scrolls/${item.iconId}.png`;
    (scrolls[stat] ||= {})[tierOf(item.name.fr)] = { id: item.id, name: item.name.fr, icon };

    const file = path.join(ROOT, icon);
    if (!fs.existsSync(file)) {
      const img = await fetch(`${API}/img/items/${item.iconId}.png`);
      if (img.ok) {
        fs.mkdirSync(ICONS_DIR, { recursive: true });
        fs.writeFileSync(file, Buffer.from(await img.arrayBuffer()));
      }
    }
  }

  const count = Object.values(scrolls).reduce((n, tiers) => n + Object.keys(tiers).length, 0);
  fs.writeFileSync(OUT, '// Fichier généré par scripts/fetchScrolls.js — ne pas modifier à la main.\n'
    + `window.DOFUS_SCROLLS = ${JSON.stringify(scrolls, null, 2)};\n`, 'utf-8');
  console.log(`${count} parchemins enregistrés dans data/dofus/scrolls.js`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });

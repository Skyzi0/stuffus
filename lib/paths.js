// Emplacements des fichiers, communs au serveur et aux scripts.
//
// - Code, notes et données fixes : dans le projet (distribués avec git).
// - Données du jeu (DofusDB) : data/dofus/ et assets/ du projet, téléchargées sur chaque installation (npm run setup).
// - Données personnelles (dossiers, personnages, stuffs, stock, fabrication, tags, corbeille) : dans le
//   « dossier de données », data/ du projet par défaut. Il peut être placé ailleurs, par exemple dans un dossier
//   synchronisé (OneDrive, Google Drive…) pour retrouver les mêmes données sur plusieurs PC :
//     config.json         { "dossierDonnees": "C:/Users/moi/OneDrive/Stuffus", "port": 4310 }
//     ou la variable d'environnement STUFFUS_DONNEES (prioritaire), et PORT pour le port.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    throw new Error(`config.json illisible (${err.message}). Vérifier sa syntaxe, par exemple : { "port": 4310 }`);
  }
}

const config = readConfig();
const PERSONAL_DIR = path.resolve(ROOT, process.env.STUFFUS_DONNEES || config.dossierDonnees || 'data');

module.exports = {
  ROOT,
  config,
  CONFIG_PATH,
  PORT: Number(process.env.PORT) || Number(config.port) || 4310,
  // Données du jeu (téléchargées) et données fixes du projet.
  GAME_DIR: path.join(ROOT, 'data', 'dofus'),
  DEFAULT_TAGS_PATH: path.join(ROOT, 'data', 'defaults', 'tags.js'),
  // Données personnelles.
  PERSONAL_DIR,
  FOLDERS_PATH: path.join(PERSONAL_DIR, 'folders.js'),
  FOLDERS_DIR: path.join(PERSONAL_DIR, 'folders'),
  TAGS_PATH: path.join(PERSONAL_DIR, 'tags.js'),
  TRASH_DIR: path.join(PERSONAL_DIR, 'corbeille'),
  // Fichiers personnels servis au site sous data/ (quel que soit le dossier de données).
  PERSONAL_URLS: ['/data/folders.js', '/data/tags.js', '/data/folders/'],
};

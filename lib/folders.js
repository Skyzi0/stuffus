// Dossiers de données, pour les scripts en ligne de commande.
// Avant le premier démarrage du serveur (pas de folders.js), les données sont à la racine du dossier de données.
const fs = require('fs');
const path = require('path');
const { PERSONAL_DIR } = require('./paths.js');

function readWindowVar(file) {
  if (!fs.existsSync(file)) return null;
  const source = fs.readFileSync(file, 'utf-8');
  return JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;$/, ''));
}

// [{ id, name, dir }] ; id = null pour l'ancienne organisation (data/). root : inutilisé (ancien paramètre).
// eslint-disable-next-line no-unused-vars
function listFolders(root) {
  const dataDir = PERSONAL_DIR;
  const folders = readWindowVar(path.join(dataDir, 'folders.js'));
  if (!folders) return [{ id: null, name: 'data', dir: dataDir }];
  return folders.map((f) => ({ id: f.id, name: f.name, dir: path.join(dataDir, 'folders', f.id) }));
}

// Dossiers visés par l'option « --dossier <id> » (tous si elle est absente).
function selectFolders(root, argv) {
  const all = listFolders(root);
  const i = argv.indexOf('--dossier');
  if (i < 0) return all;
  const wanted = argv[i + 1];
  const found = all.filter((f) => f.id === wanted);
  if (!found.length) throw new Error(`Dossier inconnu : ${wanted} (disponibles : ${all.map((f) => f.id).join(', ')})`);
  return found;
}

module.exports = { readWindowVar, listFolders, selectFolders };

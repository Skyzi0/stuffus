# Stuffus

Suivi des stuffs de vos personnages Dofus : équipements et forgemagie, stock, banque d'objets, parchottage,
sorts communs et fabrication. Le site tourne sur votre PC : rien n'est envoyé en ligne.

## Installation

1. Installer **Node.js** (version LTS) depuis <https://nodejs.org>.
2. Télécharger la dernière version de Stuffus et la décompresser dans un dossier.
3. Double-cliquer sur **`Lancer Stuffus.bat`**.

Au premier lancement, les données du jeu (objets, panoplies, recettes, icônes) sont téléchargées depuis
[DofusDB](https://dofusdb.fr) : comptez quelques minutes. Le site s'ouvre ensuite dans le navigateur, à l'adresse
<http://127.0.0.1:4310>.

Laisser la fenêtre noire ouverte pendant l'utilisation : la fermer arrête le site.

> Sans le fichier `.bat` (autre système que Windows) : ouvrir un terminal dans le dossier et lancer `npm start`.

## Mettre à jour

- **Stuffus** : remplacer les fichiers du dossier par ceux de la nouvelle version. Vos données ne sont pas touchées
  (voir plus bas où elles se trouvent).
- **Données du jeu**, après une mise à jour de Dofus : lancer `npm run update-data` dans le dossier de Stuffus.

## Vos données

Vos dossiers, personnages, stuffs, stock, fabrication et tags sont enregistrés dans le dossier `data/` de Stuffus :
`data/folders.js`, `data/folders/` et `data/tags.js`. Pour les sauvegarder, copier ces fichiers.

### Retrouver les mêmes données sur plusieurs PC

Les données peuvent être placées dans un dossier synchronisé (OneDrive, Google Drive…) :

1. Copier `config.example.json` en `config.json`, à côté de `Lancer Stuffus.bat`.
2. Y indiquer le dossier synchronisé (avec des `/`) :

   ```json
   {
     "port": 4310,
     "dossierDonnees": "C:/Users/MonNom/OneDrive/Stuffus"
   }
   ```

3. Pour reprendre des données existantes, déplacer `data/folders.js`, `data/folders/` et `data/tags.js` dans ce
   dossier. Un dossier vide est rempli automatiquement au premier lancement.

Faire de même sur chaque PC. **N'utiliser Stuffus que sur un PC à la fois** : deux PC ouverts en même temps sur les
mêmes données s'écraseraient leurs modifications.

## Problèmes courants

- **« Le port 4310 est déjà utilisé »** : Stuffus est peut-être déjà ouvert dans une autre fenêtre. Sinon, choisir un
  autre port dans `config.json` (par exemple `"port": 4311`).
- **« Node.js n'est pas installé »** : installer Node.js (étape 1) puis relancer.
- **Données du jeu incomplètes** (pas de connexion au premier lancement) : relancer `Lancer Stuffus.bat`, les
  téléchargements manquants reprennent.

## Crédits

Données et icônes du jeu : [DofusDB](https://dofusdb.fr) ; Dofus est un jeu d'Ankama.

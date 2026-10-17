// Moyens d'obtention des sorts communs, affichés sous chaque paire (personnages et banque d'objets).
// Fichier à modifier à la main : remplir le texte entre guillemets (laisser "" pour ne rien afficher).
// La clé est l'identifiant DofusDB de la paire de variantes (voir data/dofus/common-spells.js).
//
// Texte à copier d'un clic dans le presse-papier :
//   [[/travel -2,0]]               affiche « /travel -2,0 » et le copie
//   [[Position|/travel -2,0]]      affiche « Position » et copie « /travel -2,0 »
// Exemple : "Quête du Dragon Cochon, départ en [[Position|/travel -2,0]]"
window.SPELL_NOTES = {
  // Invocation de l'Arakne / Invocation de l'Arakne Majeure
  491: "Affronter l'Araknelle en [[11,8|/travel 11,8]] ou s'achète à Xanmala contre x200 Almatons en [[-4,-24|/travel -4,-24]]",
  // Libération / Attraction
  493: "Achat contre x1000 Pépites auprès de Pépita en [[13,35|/travel 13,35]]",
  // Maîtrise des Invocations / Liberté des Invocations
  481: "Parler à Abrazelon Sixgriffe en [[-2,-15|/travel -2,-15]]",
  // Cawotte Savouweuse / Cawotte Chawnue
  490: "Contre x100 Cawotte à Wob en [[22,-7|/travel 22,-7]]",
  // Foudroiement de Grunob / Leçon de Grunob
  489: "Clic sur l'armoire dans la première salle de l'Akadémie des Gobs en [[-5,3|/travel -5,3]]",
  // Invocation de Chaferfu / Invocation de Chaferfu Lancier
  492: "Fin du Donjon des Squelettes en [[10,15|/travel 10,15]]",
  // Flamèche / Flamiche
  484: "Achat contre x1000 Pépites auprès de Pépita en [[13,35|/travel 13,35]]",
  // Maîtrise d'Arme / Maladresse d'Arme
  494: "Fin du Donjon des Forgerons en [[13,21|/travel 13,21]]",
  // Kannibulle / Ebilition
  488: "Clic sur la jarre à la fin du Village Kanniboul en [[29,9|/travel 29,9]]",
  // Mantiscroc / Dard Moklès
  487: "Clic sur l'ossement à la fin du Cimetière des mastodontes en [[19,-61|/travel 19,-61]]",
  // Marteau de Moon / Marteau de Darkli Moon
  486: "Fin de l'Arbre de Moon en [[29,6|/travel 29,6]]",
  // Boomerang Perfide / Boomerang de Diamantine
  485: "Repaire de Skeunk en [[-20,10|/travel -20,10]] contre x10 Boomerang Koalak Sanguin, Maître Koalak, Dok Alako et Warko Marron",
};

// typeIds DofusDB acceptés par chaque emplacement de stuff.
// Partagé entre le site (window.SLOTS) et les scripts Node (require).
(function (root) {
  const WEAPON_TYPES = [2, 3, 4, 5, 6, 7, 8, 19, 22, 271];
  const SLOT_TYPES = {
    Chapeau: [16],
    Cape: [17],
    Amulette: [1],
    'Anneau 1': [9],
    'Anneau 2': [9],
    Ceinture: [10],
    Bottes: [11],
    Bouclier: [82],
    Arme: WEAPON_TYPES,
    Familier: [18, 121, 331, 332, 333],
    Dofus: [23, 151, 217],
  };

  function slotTypes(slot) {
    return SLOT_TYPES[slot] || (slot.startsWith('Dofus') ? SLOT_TYPES.Dofus : []);
  }

  // Emplacements d'un stuff, dans l'ordre du tableau.
  const SLOT_ORDER = [
    'Chapeau', 'Cape', 'Amulette', 'Anneau 1', 'Anneau 2', 'Ceinture', 'Bottes', 'Bouclier', 'Arme',
    'Familier', 'Dofus 1', 'Dofus 2', 'Dofus 3', 'Dofus 4', 'Dofus 5', 'Dofus 6',
  ];

  const api = { SLOT_TYPES, SLOT_ORDER, slotTypes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SLOTS = api;
})(this);

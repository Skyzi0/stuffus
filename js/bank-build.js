// Construit la banque d'objets à partir des stuffs.
// Partagé entre le site (window.BANK_BUILD) et scripts/buildBank.js (require).
//
// Règles :
//   - un objet = une variante d'emplacement + ses tags (forgemagie) ;
//     accents / casse / espaces ignorés ; « A ou B » donne deux objets, chacun avec son état ;
//   - dans une classe, un objet n'est compté qu'une fois, même s'il est dans plusieurs stuffs ;
//   - la quantité est le nombre de classes (personnages) qui l'utilisent ;
//   - l'état d'un personnage est le plus avancé parmi ses stuffs (possédé > fabriqué > à obtenir).
(function (root) {
  const CATEGORIES = ['Chapeau', 'Cape', 'Amulette', 'Anneau', 'Ceinture', 'Bottes', 'Bouclier', 'Arme', 'Familier', 'Dofus & Trophées'];
  // États d'un objet, du moins au plus avancé. « crafted » = fabriqué, pas encore forgemagé.
  const STATUSES = ['missing', 'crafted', 'owned'];

  // État d'une variante (ou d'un lot, d'un détenteur). Anciennes données : état porté par
  // l'emplacement (item.status), ou booléen « owned ».
  function statusOf(obj, item) {
    if (STATUSES.includes(obj.status)) return obj.status;
    if (item && item !== obj) return statusOf(item);
    return obj.owned ? 'owned' : 'missing';
  }

  // Tags d'une variante. Anciennes données : tags portés par l'emplacement.
  function bonusesOf(variant, item) {
    return variant.bonuses || (item && item.bonuses) || [];
  }

  // Niveau d'un stuff : celui saisi, sinon celui de son objet le plus haut niveau.
  // gameItem(variant) -> objet DofusDB { level } ou null. Retourne { level, derived } ou null.
  function stuffLevel(stuff, gameItem) {
    if (stuff.level) return { level: stuff.level, derived: false };
    let max = 0;
    stuff.items.forEach((item) => item.variants.forEach((v) => {
      const game = gameItem && gameItem(v);
      if (game && game.level > max) max = game.level;
    }));
    return max ? { level: max, derived: true } : null;
  }

  // Nom d'un stuff suivi de son niveau : « Eau Crit (niv. 200) ».
  function stuffLabel(stuff, gameItem) {
    const lvl = stuffLevel(stuff, gameItem);
    return lvl ? stuff.name + ' (niv. ' + lvl.level + ')' : stuff.name;
  }

  // État d'un emplacement : celui de sa variante la plus avancée (une seule suffit au personnage).
  function slotStatus(item) {
    return item.variants.reduce((best, v) => bestStatus(best, statusOf(v, item)), 'missing');
  }

  function bestStatus(a, b) {
    return STATUSES.indexOf(a) >= STATUSES.indexOf(b) ? a : b;
  }

  function categoryOf(slot) {
    if (slot.startsWith('Anneau')) return 'Anneau';
    if (slot.startsWith('Dofus')) return 'Dofus & Trophées';
    return slot;
  }

  function normalize(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Identité d'un objet : ses variantes (id DofusDB, sinon nom) + ses tags.
  function keyOf(variants, bonuses) {
    const itemKey = variants.map((v) => (v.itemId ? '#' + v.itemId : normalize(v.name))).sort().join('/');
    const tagKey = bonuses.map((b) => b.kind + ':' + normalize(b.text)).sort().join(',');
    return itemKey + '|' + tagKey;
  }

  function compareEntries(a, b) {
    return CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category)
      || a.variants[0].name.localeCompare(b.variants[0].name, 'fr')
      || a.key.localeCompare(b.key);
  }

  // itemsById : Map id -> { name } ; iconLinks : { nom du tableau -> { id } } (data/item-icons.js).
  function buildBank(classes, { itemsById, iconLinks }) {
    const gameId = (v) => v.itemId || (iconLinks[v.name] && iconLinks[v.name].id) || null;
    const gameItem = (v) => itemsById.get(gameId(v)) || null;
    const entries = new Map();

    for (const cls of classes) {
      for (const stuff of cls.stuffs) {
        for (const item of stuff.items) {
          for (const v of item.variants) {
            const id = gameId(v);
            const game = id && itemsById.get(id);
            const variants = [{ name: game ? game.name : v.name, itemId: id }];
            const bonuses = bonusesOf(v, item);
            const key = keyOf(variants, bonuses);

            if (!entries.has(key)) {
              entries.set(key, {
                key,
                category: categoryOf(item.slot),
                variants,
                bonuses: bonuses.map((b) => ({ text: b.text, kind: b.kind })),
                holders: [],
              });
            }
            const entry = entries.get(key);
            // Détenteur = personnage (nom affiché) ; classType sert à son icône.
            let holder = entry.holders.find((h) => h.class === cls.name);
            if (!holder) entry.holders.push(holder = { class: cls.name, classType: cls.class || cls.name, status: 'missing', stuffs: [] });
            holder.status = bestStatus(holder.status, statusOf(v, item));
            const label = stuffLabel(stuff, gameItem);
            if (!holder.stuffs.includes(label)) holder.stuffs.push(label);
          }
        }
      }
    }

    return [...entries.values()].map(withCounts).sort(compareEntries);
  }

  function withCounts(entry) {
    const count = (status) => entry.holders.filter((h) => h.status === status).length;
    return Object.assign(entry, { quantity: entry.holders.length, owned: count('owned'), crafted: count('crafted') });
  }

  // Exports antérieurs à l'état « fabriqué » : holders[].owned booléen.
  function normalizeEntries(entries) {
    entries.forEach((e) => {
      e.holders.forEach((h) => { h.status = statusOf(h); delete h.owned; });
      withCounts(e);
    });
    return entries;
  }

  // Empreinte servant à savoir si un export est encore à jour.
  function signature(entries) {
    return JSON.stringify(entries.map((e) => [e.key, e.holders.map((h) => [h.class, h.classType || h.class, h.status, h.stuffs])]));
  }

  const api = { CATEGORIES, STATUSES, statusOf, bonusesOf, slotStatus, stuffLevel, stuffLabel, bestStatus, categoryOf, keyOf, compareEntries, buildBank, normalizeEntries, signature };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BANK_BUILD = api;
})(this);

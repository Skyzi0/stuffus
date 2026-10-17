// Historique des modifications : construction des entrées, descriptions lisibles et annulation.
//
// Une entrée regroupe les « unités » modifiées par un enregistrement, avec leur état avant / après :
//   { type: 'class', id, index, before, after }        un personnage : nom affiché, classe, parchottage et sorts communs (sans ses stuffs)
//   { type: 'stuff', cls, clsName, id, index, before, after }   un stuff d'un personnage (null = inexistant)
//   { type: 'lot', id, index, before, after }          un lot du stock
//   { type: 'tags', before, after }                    la bibliothèque de tags (entière, elle est petite)
//   { type: 'copy', id, index, before, after }         un exemplaire de la liste de fabrication
//   { type: 'counter', id, before, after }             le compteur d'une ressource de la fabrication (nombre ou null)
// Annuler une entrée remet les « before » de cette entrée et de toutes les suivantes.

const STATUS_LABEL = { missing: 'à obtenir', crafted: 'fabriqué', owned: 'possédé' };
// Fenêtre de regroupement des enregistrements rapprochés sur les mêmes éléments.
const MERGE_WINDOW_MS = 60 * 1000;

function normalize(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Un stuff sans son identifiant (les anciens fichiers n'en ont pas).
function withoutId(stuff) {
  const { id, ...rest } = stuff;
  return rest;
}

function unitKey(unit) {
  if (unit.type === 'class') return 'class:' + unit.id;
  if (unit.type === 'stuff') return 'stuff:' + unit.cls + ':' + unit.id;
  if (unit.type === 'lot') return 'lot:' + unit.id;
  if (unit.type === 'copy') return 'copy:' + unit.id;
  if (unit.type === 'counter') return 'counter:' + unit.id;
  return 'tags';
}

// --- Construction des unités modifiées -------------------------------------------------
function classKey(cls) {
  return cls.id || cls.name;
}

// Ce que l'historique garde d'un personnage (ses stuffs sont des unités à part).
function classMeta(cls) {
  return { id: cls.id, name: cls.name, class: cls.class || cls.name, icon: cls.icon, scrolls: cls.scrolls || null, commonSpells: cls.commonSpells || null };
}

const SCROLL_STATS = { vitality: 'Vitalité', strength: 'Force', intelligence: 'Intelligence', chance: 'Chance', agility: 'Agilité', wisdom: 'Sagesse' };

// Paires de sorts communs débloquées (+) ou retirées (−).
function spellChanges(before, after, names = {}) {
  const had = new Set(before || []);
  const has = new Set(after || []);
  const name = (id) => names[id] || 'sort ' + id;
  return [...[...has].filter((id) => !had.has(id)).map((id) => '+' + name(id)), ...[...had].filter((id) => !has.has(id)).map((id) => '−' + name(id))];
}

function scrollChanges(before, after) {
  return Object.keys(SCROLL_STATS)
    .filter((stat) => ((before && before[stat]) || 0) !== ((after && after[stat]) || 0))
    .map((stat) => SCROLL_STATS[stat] + ' ' + ((before && before[stat]) || 0) + ' → ' + ((after && after[stat]) || 0));
}

function stuffsOf(oldCls, newCls) {
  const units = [];
  const key = classKey(newCls || oldCls);
  const clsName = (newCls || oldCls).name;
  const oldStuffs = ((oldCls && oldCls.stuffs) || []).map((stuff, index) => ({ stuff, index, matched: false }));

  ((newCls && newCls.stuffs) || []).forEach((stuff, index) => {
    // Par identifiant ; sinon par nom pour un ancien stuff qui n'en avait pas encore.
    const old = oldStuffs.find((o) => !o.matched && o.stuff.id && o.stuff.id === stuff.id)
      || oldStuffs.find((o) => !o.matched && !o.stuff.id && o.stuff.name === stuff.name);
    if (old) old.matched = true;
    if (old && same(withoutId(old.stuff), withoutId(stuff))) return;
    units.push({ type: 'stuff', cls: key, clsName, id: stuff.id || stuff.name, index, before: old ? old.stuff : null, after: stuff });
  });

  oldStuffs.filter((o) => !o.matched).forEach((o) => {
    units.push({ type: 'stuff', cls: key, clsName, id: o.stuff.id || o.stuff.name, index: o.index, before: o.stuff, after: null });
  });
  return units;
}

function stuffUnits(oldClasses, newClasses) {
  const units = [];
  const olds = (oldClasses || []).map((cls, index) => ({ cls, index, matched: false }));

  (newClasses || []).forEach((cls, index) => {
    // Par identifiant ; sinon par nom pour un ancien personnage qui n'en avait pas encore.
    const old = olds.find((o) => !o.matched && o.cls.id && o.cls.id === cls.id)
      || olds.find((o) => !o.matched && !o.cls.id && o.cls.name === cls.name);
    if (old) old.matched = true;
    const before = old ? classMeta(old.cls) : null;
    const after = classMeta(cls);
    // L'ajout de l'identifiant ou de l'icône n'est pas une modification.
    if (!before || before.name !== after.name || before.class !== after.class || scrollChanges(before.scrolls, after.scrolls).length
      || spellChanges(before.commonSpells, after.commonSpells).length) {
      units.push({ type: 'class', id: classKey(cls), index, before, after });
    }
    units.push(...stuffsOf(old && old.cls, cls));
  });

  olds.filter((o) => !o.matched).forEach((o) => {
    units.push(...stuffsOf(o.cls, null));
    units.push({ type: 'class', id: classKey(o.cls), index: o.index, before: classMeta(o.cls), after: null });
  });
  return units;
}

function lotUnits(oldStock, newStock) {
  const units = [];
  const oldById = new Map((oldStock || []).map((l, index) => [l.id, { lot: l, index }]));
  (newStock || []).forEach((lot, index) => {
    const old = oldById.get(lot.id);
    oldById.delete(lot.id);
    if (!old || !same(old.lot, lot)) units.push({ type: 'lot', id: lot.id, index, before: old ? old.lot : null, after: lot });
  });
  oldById.forEach((old) => units.push({ type: 'lot', id: old.lot.id, index: old.index, before: old.lot, after: null }));
  return units;
}

// Fabrication : un exemplaire par unité, un compteur de ressource par unité.
function craftUnits(oldCraft, newCraft) {
  const units = [];
  const oldById = new Map(((oldCraft && oldCraft.copies) || []).map((c, index) => [c.id, { copy: c, index }]));
  ((newCraft && newCraft.copies) || []).forEach((copy, index) => {
    const old = oldById.get(copy.id);
    oldById.delete(copy.id);
    if (!old || !same(old.copy, copy)) units.push({ type: 'copy', id: copy.id, index, before: old ? old.copy : null, after: copy });
  });
  oldById.forEach((old) => units.push({ type: 'copy', id: old.copy.id, index: old.index, before: old.copy, after: null }));

  const oldCounters = (oldCraft && oldCraft.counters) || {};
  const newCounters = (newCraft && newCraft.counters) || {};
  new Set([...Object.keys(oldCounters), ...Object.keys(newCounters)]).forEach((id) => {
    const before = oldCounters[id] ?? null;
    const after = newCounters[id] ?? null;
    if (before !== after) units.push({ type: 'counter', id, before, after });
  });
  return units;
}

// previous / next : { stuffs?, stock?, tags?, craft? } — seules les parties enregistrées sont comparées.
function buildUnits(previous, next) {
  const units = [];
  if (next.stuffs) units.push(...stuffUnits(previous.stuffs, next.stuffs));
  if (next.stock) units.push(...lotUnits(previous.stock, next.stock));
  if (next.tags && !same(previous.tags || [], next.tags)) units.push({ type: 'tags', before: previous.tags || [], after: next.tags });
  if (next.craft) units.push(...craftUnits(previous.craft, next.craft));
  return units;
}

// --- Descriptions lisibles --------------------------------------------------------------
function tagLabel(b) {
  return (b.kind === 'removed' ? '−' : '') + b.text;
}

function tagsLabel(bonuses) {
  return bonuses && bonuses.length ? ' [' + bonuses.map(tagLabel).join(', ') + ']' : '';
}

function variantId(v) {
  return v.itemId ? '#' + v.itemId : normalize(v.name);
}

function describeSlot(scope, before, after) {
  const changes = [];
  const oldVariants = (before && before.variants) || [];
  const newVariants = (after && after.variants) || [];
  const removed = oldVariants.filter((v) => !newVariants.some((n) => variantId(n) === variantId(v)));
  const added = newVariants.filter((v) => !oldVariants.some((o) => variantId(o) === variantId(v)));

  if (removed.length === 1 && added.length === 1) {
    changes.push({ scope, text: removed[0].name + ' remplacé par ' + added[0].name + tagsLabel(added[0].bonuses) });
  } else {
    removed.forEach((v) => changes.push({ scope, text: '− ' + v.name }));
    added.forEach((v) => changes.push({ scope, text: '+ ' + v.name + tagsLabel(v.bonuses) }));
  }

  newVariants.forEach((v) => {
    const old = oldVariants.find((o) => variantId(o) === variantId(v));
    if (!old) return;
    if ((old.status || 'missing') !== (v.status || 'missing')) {
      changes.push({ scope, text: v.name + ' : ' + STATUS_LABEL[old.status || 'missing'] + ' → ' + STATUS_LABEL[v.status || 'missing'] });
    }
    const oldTags = (old.bonuses || []).map(tagLabel);
    const newTags = (v.bonuses || []).map(tagLabel);
    const lost = oldTags.filter((t) => !newTags.includes(t));
    const gained = newTags.filter((t) => !oldTags.includes(t));
    if (lost.length || gained.length) {
      changes.push({ scope, text: v.name + ' : tags ' + [...gained.map((t) => '+' + t), ...lost.map((t) => '−' + t)].join(', ') });
    }
  });
  return changes;
}

function describeClass(unit, context = {}) {
  const { before, after } = unit;
  const scope = (after || before).name;
  if (!before) return [{ scope, text: 'Personnage créé (' + after.class + ')' }];
  if (!after) return [{ scope, text: 'Personnage supprimé (' + before.class + ')' }];
  const changes = [];
  if (before.name !== after.name) changes.push({ scope, text: 'Renommé (ancien nom : ' + before.name + ')' });
  if (before.class !== after.class) changes.push({ scope, text: 'Classe : ' + before.class + ' → ' + after.class });
  const scrolls = scrollChanges(before.scrolls, after.scrolls);
  if (scrolls.length) changes.push({ scope, text: 'Parchottage : ' + scrolls.join(', ') });
  const spells = spellChanges(before.commonSpells, after.commonSpells, context.spellPairs);
  if (spells.length) changes.push({ scope, text: 'Sorts communs : ' + spells.join(', ') });
  return changes;
}

function stuffLabel(stuff) {
  return stuff.level ? stuff.name + ' (niv. ' + stuff.level + ')' : stuff.name;
}

function describeStuff(unit) {
  const { before, after } = unit;
  const name = stuffLabel(after || before);
  const scope = (unit.clsName || unit.cls) + ' › ' + name;
  if (!before) return [{ scope, text: 'Stuff créé' }];
  if (!after) return [{ scope, text: 'Stuff supprimé' }];

  const changes = [];
  if (before.name !== after.name) changes.push({ scope, text: 'Renommé (ancien nom : ' + before.name + ')' });
  if ((before.level ?? null) !== (after.level ?? null)) changes.push({ scope, text: 'Niveau : ' + (before.level ?? '—') + ' → ' + (after.level ?? '—') });
  if (before.initiative !== after.initiative) changes.push({ scope, text: 'Initiative : ' + (before.initiative ?? '—') + ' → ' + (after.initiative ?? '—') });
  if ((before.link || null) !== (after.link || null)) changes.push({ scope, text: 'Lien DofusBook modifié' });

  const slots = new Set([...before.items, ...after.items].map((i) => i.slot));
  slots.forEach((slot) => {
    const b = before.items.find((i) => i.slot === slot);
    const a = after.items.find((i) => i.slot === slot);
    if (same(b, a)) return;
    changes.push(...describeSlot(scope + ' › ' + slot, b, a));
  });
  return changes.length ? changes : [{ scope, text: 'Modifié' }];
}

function describeLot(unit, context) {
  const lot = unit.after || unit.before;
  const name = lot.variants[0].name + tagsLabel(lot.bonuses);
  // Lot réservé à un personnage : « Stock de Lady-Vision ».
  const owner = lot.owner && ((context.classNames || {})[lot.owner] || 'personnage supprimé');
  const scope = owner ? 'Stock de ' + owner : 'Stock';
  if (!unit.before) return [{ scope, text: '+ ' + lot.quantity + ' × ' + name + ' (' + STATUS_LABEL[lot.status] + ')' }];
  if (!unit.after) return [{ scope, text: '− ' + lot.quantity + ' × ' + name + ' (' + STATUS_LABEL[lot.status] + ')' }];
  const changes = [];
  const b = unit.before;
  const a = unit.after;
  if (b.quantity !== a.quantity) changes.push({ scope, text: name + ' : quantité ' + b.quantity + ' → ' + a.quantity });
  if (b.status !== a.status) changes.push({ scope, text: name + ' : ' + STATUS_LABEL[b.status] + ' → ' + STATUS_LABEL[a.status] });
  if (!same(b.bonuses, a.bonuses)) changes.push({ scope, text: b.variants[0].name + ' : tags' + tagsLabel(b.bonuses) + ' →' + (tagsLabel(a.bonuses) || ' aucun') });
  if (!same(b.variants, a.variants)) changes.push({ scope, text: b.variants[0].name + ' remplacé par ' + a.variants[0].name });
  if (b.category !== a.category) changes.push({ scope, text: name + ' : catégorie ' + b.category + ' → ' + a.category });
  if ((b.owner || null) !== (a.owner || null)) {
    const label = (id) => (id ? (context.classNames || {})[id] || 'personnage supprimé' : 'stock commun');
    changes.push({ scope, text: name + ' : ' + label(b.owner) + ' → ' + label(a.owner) });
  }
  return changes.length ? changes : [{ scope, text: name + ' modifié' }];
}

// « Lady-Vision › Stuff Terre » pour un lien d'exemplaire vers un stuff.
function linkLabel(link, context) {
  const cls = (context.classNames || {})[link.cls] || 'personnage supprimé';
  const stuff = (context.stuffNames || {})[link.stuff] || 'stuff supprimé';
  return cls + ' › ' + stuff;
}

function copyDestination(copy, context) {
  if (copy.links && copy.links.length) return copy.links.map((l) => linkLabel(l, context)).join(' & ');
  return copy.owner ? 'Stock de ' + ((context.classNames || {})[copy.owner] || 'personnage supprimé') : 'Stock commun';
}

function describeCopy(unit, context) {
  const copy = unit.after || unit.before;
  const scope = 'Fabrication › ' + ((context.itemNames || {})[copy.itemId] || 'objet ' + copy.itemId);
  if (!unit.before) return [{ scope, text: 'Ajouté (' + copyDestination(copy, context) + ')' }];
  if (!unit.after) return [{ scope, text: 'Retiré de la liste (' + copyDestination(copy, context) + ')' }];
  const key = (l) => l.cls + '|' + l.stuff + '|' + l.slot;
  const oldLinks = unit.before.links || [];
  const newLinks = unit.after.links || [];
  const changes = [
    ...newLinks.filter((l) => !oldLinks.some((o) => key(o) === key(l))).map((l) => ({ scope, text: 'Lié à ' + linkLabel(l, context) })),
    ...oldLinks.filter((o) => !newLinks.some((l) => key(o) === key(l))).map((l) => ({ scope, text: 'Lien retiré : ' + linkLabel(l, context) })),
  ];
  if ((unit.before.owner || null) !== (unit.after.owner || null)) changes.push({ scope, text: 'Destination : ' + copyDestination(unit.after, context) });
  return changes.length ? changes : [{ scope, text: 'Modifié' }];
}

function describeCounter(unit, context) {
  const name = (context.resourceNames || {})[unit.id] || 'ressource ' + unit.id;
  return [{ scope: 'Fabrication › Ressources', text: name + ' : ' + (unit.before ?? 0) + ' → ' + (unit.after ?? 0) }];
}

function describeTags(unit) {
  const id = (t) => t.kind + ':' + normalize(t.text);
  const removed = unit.before.filter((t) => !unit.after.some((n) => id(n) === id(t)));
  const added = unit.after.filter((t) => !unit.before.some((o) => id(o) === id(t)));
  const scope = 'Bibliothèque de tags';
  // Un retrait + un ajout dans la même entrée : c'est un renommage.
  if (removed.length === 1 && added.length === 1) return [{ scope, text: tagLabel(removed[0]) + ' renommé en ' + tagLabel(added[0]) }];
  const changes = [
    ...added.map((t) => ({ scope, text: '+ ' + tagLabel(t) })),
    ...removed.map((t) => ({ scope, text: '− ' + tagLabel(t) })),
  ];
  return changes.length ? changes : [{ scope, text: 'Modifiée' }];
}

function describe(units, context = {}) {
  const describers = { class: describeClass, stuff: describeStuff, lot: describeLot, tags: describeTags, copy: describeCopy, counter: describeCounter };
  const changes = units.flatMap((u) => describers[u.type](u, context));
  // Action nommée par le site (« Validé : 2 × Gelano ») : en tête de l'entrée.
  return context.label ? [{ scope: 'Fabrication', text: context.label }, ...changes] : changes;
}

// --- Journal ---------------------------------------------------------------------------
function newId() {
  return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Ajoute un enregistrement au journal (regroupé avec le précédent s'il est rapproché et touche les mêmes éléments).
// context : { classNames: { id -> nom } } pour décrire les stocks des personnages.
function record(history, previous, next, now = Date.now(), context = {}) {
  const units = buildUnits(previous, next);
  if (!units.length) return history;

  const last = history[history.length - 1];
  const lastKeys = last ? new Set(last.units.map(unitKey)) : null;
  // Une action nommée (validation, suppression…) a toujours sa propre entrée.
  if (last && !context.label && !last.label && now - Date.parse(last.at) < MERGE_WINDOW_MS && units.every((u) => lastKeys.has(unitKey(u)))) {
    units.forEach((u) => { last.units.find((l) => unitKey(l) === unitKey(u)).after = u.after; });
    // Revenu à l'état de départ : l'élément ne fait plus partie de l'entrée.
    last.units = last.units.filter((u) => !same(u.before, u.after));
    if (!last.units.length) { history.pop(); return history; }
    last.at = new Date(now).toISOString();
    last.changes = describe(last.units, context);
    return history;
  }

  const entry = { id: newId(), at: new Date(now).toISOString(), units, changes: describe(units, context) };
  if (context.label) entry.label = context.label;
  history.push(entry);
  return history;
}

// Annule l'entrée « id » et toutes les suivantes. state : { stuffs, stock, tags } (modifié sur place).
// Retourne le nombre d'entrées annulées, ou 0 si l'entrée est introuvable.
function undo(history, id, state) {
  const start = history.findIndex((e) => e.id === id);
  if (start < 0) return 0;
  const undone = history.splice(start);

  // Personnage d'une unité : par identifiant, ou par nom pour les entrées antérieures aux identifiants.
  const findClass = (key) => state.stuffs.find((c) => c.id === key) || state.stuffs.find((c) => c.name === key);

  undone.reverse().forEach((entry) => {
    const units = [...entry.units].reverse();
    // 1) Personnages supprimés ou modifiés : remis (sans stuffs, ceux-ci suivent).
    units.filter((u) => u.type === 'class' && u.before).forEach((unit) => {
      const cls = findClass(unit.id);
      if (cls) Object.assign(cls, unit.before);
      else state.stuffs.splice(Math.min(unit.index, state.stuffs.length), 0, Object.assign({}, unit.before, { stuffs: [] }));
    });
    // 2) Stuffs, stock et tags.
    units.filter((u) => u.type !== 'class').forEach((unit) => applyUndo(unit, state, findClass));
    // 3) Personnages créés : retirés.
    units.filter((u) => u.type === 'class' && !u.before).forEach((unit) => {
      const cls = findClass(unit.id);
      if (cls) state.stuffs.splice(state.stuffs.indexOf(cls), 1);
    });
  });
  return undone.length;
}

function applyUndo(unit, state, findClass) {
  if (unit.type === 'tags') {
    state.tags = unit.before;
  } else if (unit.type === 'copy') {
    const copies = state.craft.copies;
    const i = copies.findIndex((c) => c.id === unit.id);
    if (unit.before && i >= 0) copies[i] = unit.before;
    else if (unit.before) copies.splice(Math.min(unit.index ?? copies.length, copies.length), 0, unit.before);
    else if (i >= 0) copies.splice(i, 1);
  } else if (unit.type === 'counter') {
    if (unit.before === null) delete state.craft.counters[unit.id];
    else state.craft.counters[unit.id] = unit.before;
  } else if (unit.type === 'lot') {
    const i = state.stock.findIndex((l) => l.id === unit.id);
    if (unit.before && i >= 0) state.stock[i] = unit.before;
    else if (unit.before) state.stock.splice(Math.min(unit.index ?? state.stock.length, state.stock.length), 0, unit.before);
    else if (i >= 0) state.stock.splice(i, 1);
  } else {
    const cls = findClass(unit.cls);
    if (!cls) return;
    const i = cls.stuffs.findIndex((s) => (s.id || s.name) === unit.id);
    if (unit.before && i >= 0) cls.stuffs[i] = unit.before;
    else if (unit.before) cls.stuffs.splice(Math.min(unit.index, cls.stuffs.length), 0, unit.before);
    else if (i >= 0) cls.stuffs.splice(i, 1);
  }
}

module.exports = { record, undo, describe };

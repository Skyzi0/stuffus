(function () {
  const classes = window.STUFFS || [];
  // Objets en stock, pas encore attribués à un stuff : { id, category, variants, bonuses, quantity, status }.
  const stock = window.STOCK || [];
  const icons = window.ITEM_ICONS || {};
  const dofusItems = window.DOFUS_ITEMS || [];
  const itemsById = new Map(dofusItems.map((i) => [i.id, i]));
  const STORAGE_KEY = "tracking-stuff:owned" + (window.CURRENT_FOLDER ? ":" + window.CURRENT_FOLDER.id : "");
  const KIND_LABEL = { trans: "Trans", over: "Over", exo: "Exo", removed: "Statistique à retirer de l'objet" };
  // Abréviations utilisées après « w/ » (même table que scripts/extract_stuffs.py).
  const REMOVED_STAT_NAMES = { ini: "Initiative", vita: "Vitalité", sa: "Sagesse", pros: "Prospection" };
  const DOFUSDB_IMG_URL = "https://api.dofusdb.fr/img/items/";
  // Servi par server.js : les modifications sont enregistrées dans le dossier courant (data/folders/<id>/).
  const canSave = location.protocol !== "file:";
  const folders = window.FOLDERS || [];
  const folder = window.CURRENT_FOLDER || null;
  const folderQuery = folder ? "?dossier=" + encodeURIComponent(folder.id) : "";

  const nav = document.getElementById("classes");
  const content = document.getElementById("content");
  const search = document.getElementById("search");
  const editBtn = document.getElementById("edit-toggle");
  const saveStatus = document.getElementById("save-status");
  const picker = document.getElementById("picker");
  const pickerTitle = document.getElementById("picker-title");
  const pickerSearch = document.getElementById("picker-search");
  const pickerList = document.getElementById("picker-list");

  let editing = false;
  let current = (!["banque", "fabrication", "tags", "historique", "historique-fabrication"].includes(location.hash.slice(1)) && decodeURIComponent(location.hash.slice(1))) || (classes[0] && classes[0].name);

  // --- Cases « obtenu » ------------------------------------------------------
  // Sans serveur : modifications locales par rapport au fichier, { clé: true|false }.
  let overrides = load(STORAGE_KEY, {});

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }

  function storeOverrides() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); } catch (e) { /* stockage indisponible */ }
  }

  function itemKey(cls, stuff, item) {
    return [cls.name, stuff.name, item.slot].join("|");
  }

  // État d'un objet : missing (à obtenir) -> crafted (fabriqué, pas encore forgemagé) -> owned (possédé).
  const STATUSES = window.BANK_BUILD.STATUSES;
  const STATUS_LABEL = { missing: "À obtenir", crafted: "Fabriqué — pas encore modifié", owned: "Possédé" };
  const STATUS_SHORT = { missing: "à obtenir", crafted: "fabriqué", owned: "possédé" };

  // Chaque variante d'un emplacement a son propre état.
  function variantKey(cls, stuff, item, index) {
    return itemKey(cls, stuff, item) + "|" + index;
  }

  function variantStatusOf(cls, stuff, item, index) {
    // Valeurs locales (sans serveur) : par variante, ou anciennes valeurs par emplacement / booléens.
    for (const key of [variantKey(cls, stuff, item, index), itemKey(cls, stuff, item)]) {
      if (!(key in overrides)) continue;
      const value = overrides[key];
      return STATUSES.includes(value) ? value : (value ? "owned" : "missing");
    }
    return window.BANK_BUILD.statusOf(item.variants[index], item);
  }

  function setVariantStatus(cls, stuff, item, index, value) {
    const variant = item.variants[index];
    if (canSave) {
      variant.status = value;
      scheduleSave();
      craftOnStatusChange(cls, stuff, item, index, value);
      return;
    }
    const key = variantKey(cls, stuff, item, index);
    if (value === variant.status) delete overrides[key]; else overrides[key] = value;
    storeOverrides();
  }

  // État d'un emplacement : celui de sa variante la plus avancée (une seule suffit au personnage).
  function slotStatusOf(cls, stuff, item) {
    return item.variants.reduce((best, v, i) => window.BANK_BUILD.bestStatus(best, variantStatusOf(cls, stuff, item, i)), "missing");
  }

  // Anciennes données : état porté par l'emplacement (« status » ou booléen « owned ») -> par variante.
  function migrateStatus() {
    let changed = false;
    classes.forEach((cls) => cls.stuffs.forEach((stuff) => stuff.items.forEach((item) => {
      item.variants.forEach((v) => {
        if (STATUSES.includes(v.status)) return;
        v.status = window.BANK_BUILD.statusOf(v, item);
        changed = true;
      });
      if ("status" in item || "owned" in item) {
        delete item.status;
        delete item.owned;
        changed = true;
      }
    })));
    if (changed && canSave) scheduleSave();
  }

  // Les 19 classes du jeu (une icône assets/classes/<classe>.png chacune).
  const GAME_CLASSES = ["Crâ", "Ecaflip", "Eliotrope", "Eniripsa", "Enutrof", "Féca", "Forgelance", "Huppermage", "Iop",
    "Osamodas", "Ouginak", "Pandawa", "Roublard", "Sacrieur", "Sadida", "Sram", "Steamer", "Xélor", "Zobal"];

  function gameClassOf(name) {
    return GAME_CLASSES.find((c) => normalize(c) === normalize(name)) || null;
  }

  // Icône d'une classe : assets/classes/<nom sans accent ni majuscule>.png (« Crâ » -> cra.png).
  function classIcon(name) {
    return "assets/classes/" + normalize(name).replace(/[^a-z0-9]+/g, "") + ".png";
  }

  // Personnage : { id, name (nom affiché), class (classe du jeu, donne l'icône), icon, stuffs }.
  // Anciennes données : ni identifiant ni classe (le nom était la classe), icônes .jpg du Google Sheet.
  function migrateCharacters() {
    let changed = false;
    classes.forEach((cls) => {
      const before = JSON.stringify([cls.id, cls.class, cls.icon]);
      if (!cls.id) cls.id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      if (!cls.class) cls.class = gameClassOf(cls.name) || cls.name;
      cls.icon = classIcon(cls.class);
      if (JSON.stringify([cls.id, cls.class, cls.icon]) !== before) changed = true;
    });
    if (changed && canSave) scheduleSave();
  }

  function newStuffId() {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Chaque stuff a un identifiant stable (l'historique reconnaît ainsi un stuff renommé).
  function ensureStuffIds() {
    let changed = false;
    classes.forEach((cls) => cls.stuffs.forEach((stuff) => {
      if (stuff.id) return;
      stuff.id = newStuffId();
      changed = true;
    }));
    if (changed && canSave) scheduleSave();
  }

  // Anciennes données : tags portés par l'emplacement -> tags de chaque variante.
  function migrateBonuses() {
    let changed = false;
    classes.forEach((cls) => cls.stuffs.forEach((stuff) => stuff.items.forEach((item) => {
      item.variants.forEach((v) => {
        if (Array.isArray(v.bonuses)) return;
        v.bonuses = window.BANK_BUILD.bonusesOf(v, item).map((b) => ({ text: b.text, kind: b.kind }));
        changed = true;
      });
      if ("bonuses" in item) { delete item.bonuses; changed = true; }
    })));
    if (changed && canSave) scheduleSave();
  }

  // Anciennes données : « Trans 8 Do Crit w/ Ini » -> « Trans 8 Do Crit » + stat retirée « Initiative ».
  function splitRemovedStats() {
    let changed = false;
    classes.forEach((cls) => cls.stuffs.forEach((stuff) => stuff.items.forEach((item) => item.variants.forEach((variant) => {
      if (!variant.bonuses.some((b) => b.kind !== "removed" && /w\//i.test(b.text))) return;
      variant.bonuses = variant.bonuses.flatMap((b) => {
        if (b.kind === "removed" || !/w\//i.test(b.text)) return [b];
        const [base, ...removed] = b.text.split(/\s*w\/\s*/i);
        const parts = base ? [{ text: base, kind: b.kind }] : [];
        removed.forEach((part) => part.split(/\s*,\s*/).filter(Boolean).forEach((stat) => {
          parts.push({ text: REMOVED_STAT_NAMES[stat.toLowerCase()] || stat, kind: "removed" });
        }));
        return parts;
      });
      changed = true;
    }))));
    if (changed && canSave) scheduleSave();
  }

  // Avec le serveur, les états modifiés dans le navigateur sont reportés dans le fichier.
  function migrateOverrides() {
    if (!canSave || !Object.keys(overrides).length) return;
    classes.forEach((cls) => cls.stuffs.forEach((stuff) => stuff.items.forEach((item) => {
      item.variants.forEach((v, i) => { v.status = variantStatusOf(cls, stuff, item, i); });
    })));
    overrides = {};
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* stockage indisponible */ }
    scheduleSave();
  }

  // --- Enregistrement --------------------------------------------------------
  let saveTimer = null;
  let saving = Promise.resolve();
  // Fichiers à enregistrer : "stuffs" (data/stuffs.js), "stock", "tags", "bank", "craft".
  const dirty = new Set();
  // Historique de l'enregistrement en attente ("general" ou "fabrication") et nom de l'action éventuel.
  let saveLog = "general";
  let saveLabel = null;

  function setStatus(text, state) {
    saveStatus.textContent = text;
    saveStatus.dataset.state = state || "";
  }

  // À appeler AVANT de modifier les données pour une action d'un autre historique ou nommée :
  // les modifications en attente partent d'abord, dans leur propre entrée.
  function prepareSave(options = {}) {
    const log = options.log || "general";
    if (dirty.size && (log !== saveLog || options.label || saveLabel)) flushNow();
    saveLog = log;
    if (options.label) saveLabel = options.label;
  }

  function scheduleSave(target = "stuffs", options = {}) {
    prepareSave(options);
    [].concat(target).forEach((t) => {
      dirty.add(t);
      if (t === "stuffs") dirty.add("bank");
    });
    clearTimeout(saveTimer);
    setStatus("Modifications en attente…", "pending");
    saveTimer = setTimeout(() => { saveTimer = null; flushNow(); }, 400);
  }

  function payloadFor(target) {
    if (target === "stock") return stock;
    if (target === "tags") return tagLibrary;
    if (target === "craft") return craft;
    if (target === "bank") return { exportedAt: new Date().toISOString(), entries: liveBank() };
    return classes;
  }

  // Prend l'état actuel tout de suite (les modifications suivantes n'y seront pas) et l'envoie à son tour.
  function flushNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!dirty.size) return;
    const targets = [...dirty];
    dirty.clear();
    const body = { log: saveLog };
    if (saveLabel) body.label = saveLabel;
    saveLabel = null;
    targets.forEach((target) => { body[target] = payloadFor(target); });
    const json = JSON.stringify(body);
    saving = saving.then(() => sendSave(json, targets));
  }

  async function sendSave(json, targets) {
    setStatus("Enregistrement…", "pending");
    try {
      // Un seul envoi : une action qui touche plusieurs fichiers donne une seule entrée d'historique.
      const res = await fetch("api/save" + folderQuery, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "HTTP " + res.status);
      if (!saveTimer && !dirty.size) setStatus("Enregistré", "ok");
      if (currentView() === "history") loadHistory();
    } catch (err) {
      targets.forEach((t) => dirty.add(t));
      setStatus("Erreur d'enregistrement : " + err.message, "error");
    }
  }

  // Termine les enregistrements en attente (avant une annulation par exemple).
  async function flushSaves() {
    flushNow();
    await saving;
  }

  window.addEventListener("beforeunload", (e) => {
    if (saveTimer || saveStatus.dataset.state === "pending") e.preventDefault();
  });

  // --- Utilitaires -----------------------------------------------------------
  function groupOf(item) {
    if (item.slot.startsWith("Dofus")) return "Dofus & Trophées";
    if (item.slot === "Familier") return "Familier";
    return "Équipements";
  }

  function normalize(s) {
    return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function matches(item, query) {
    const names = item.variants.map((v) => v.name);
    const bonuses = item.variants.flatMap((v) => v.bonuses.map((b) => b.text));
    return !query || normalize([item.slot, ...names, ...bonuses].join(" ")).includes(query);
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => c && node.append(c));
    return node;
  }

  // Surligne la recherche dans un texte (comparaison sans accents).
  function highlight(text, query) {
    const frag = document.createDocumentFragment();
    const idx = query ? normalize(text).indexOf(query) : -1;
    if (idx < 0) { frag.append(text); return frag; }
    frag.append(text.slice(0, idx), el("mark", { text: text.slice(idx, idx + query.length) }), text.slice(idx + query.length));
    return frag;
  }

  // Icône locale si disponible, sinon celle de DofusDB.
  function iconImg(variant) {
    const game = itemsById.get(variant.itemId);
    const link = icons[variant.name];
    if (!game && !link) return el("span", { class: "icon" });
    const img = el("img", {
      class: "icon",
      alt: "",
      loading: "lazy",
      src: game ? "assets/items/" + game.iconId + ".png" : link.icon,
      title: (game || link).name + " — niv. " + (game || link).level,
    });
    if (game) img.addEventListener("error", () => { img.src = DOFUSDB_IMG_URL + game.iconId + ".png"; }, { once: true });
    return img;
  }

  // Objet légendaire d'après DofusDB ; sans lien vers le jeu, l'étoile du tableau Google Sheet sert de repli.
  function isLegendary(variant) {
    const game = itemsById.get(gameIdOf(variant));
    return game ? !!game.legendary : !!variant.starred;
  }

  function legendaryStar(legendary) {
    return legendary ? el("span", { class: "star", title: "Objet légendaire", text: "★" }) : null;
  }

  // --- Sélecteur d'objets ----------------------------------------------------
  // pickerTarget : { types, selectedId, stockCategory, onChoose(gameItem), onChooseStock(lot) }
  let pickerTarget = null;
  let pickerOptions = [];
  let pickerActive = 0;

  // Objets choisis dans l'éditeur : itemId ; objets venant du Sheet : lien par nom.
  function gameIdOf(variant) {
    return variant.itemId || (icons[variant.name] && icons[variant.name].id);
  }

  function candidatesFor(types) {
    return dofusItems
      .filter((i) => types.includes(i.typeId))
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name, "fr"));
  }

  // typeIds DofusDB d'une catégorie de la banque (Anneau, Dofus & Trophées…).
  function typesForCategory(category) {
    if (category === "Anneau") return window.SLOTS.slotTypes("Anneau 1");
    if (category === "Dofus & Trophées") return window.SLOTS.slotTypes("Dofus 1");
    return window.SLOTS.slotTypes(category);
  }

  function openItemPicker(title, target) {
    if (!dofusItems.length) {
      alert("Liste des objets absente : lancer npm run fetch:items.");
      return;
    }
    pickerTarget = target;
    pickerTitle.textContent = title;
    pickerSearch.value = "";
    pickerOptions = candidatesFor(target.types).filter(target.filter || (() => true));
    renderPickerList(target.selectedId, true);
    picker.showModal();
    // Le défilement ne fonctionne qu'une fois la fenêtre affichée : objet du curseur au centre.
    const active = pickerList.querySelectorAll(".picker-option")[pickerActive];
    if (active) active.scrollIntoView({ block: "center" });
    pickerSearch.focus();
  }

  // Niveau d'un stuff (saisi, sinon déduit de son objet le plus haut niveau) et libellé « Nom (niv. 200) ».
  function stuffLevel(stuff) {
    return window.BANK_BUILD.stuffLevel(stuff, (v) => itemsById.get(gameIdOf(v)) || null);
  }

  function stuffLabel(stuff) {
    return window.BANK_BUILD.stuffLabel(stuff, (v) => itemsById.get(gameIdOf(v)) || null);
  }

  // Objets de la même catégorie utilisés dans les autres stuffs du personnage, regroupés par objet + tags,
  // sauf ceux déjà équipés dans ce stuff (hors variante remplacée). { variant, status (le plus avancé), stuffs: [noms] }
  function characterReuses(stuff, item, index) {
    const cls = classes.find((c) => c.stuffs.includes(stuff));
    const category = window.BANK_BUILD.categoryOf(item.slot);
    const keyOfVariant = (v) => {
      const id = gameIdOf(v);
      const game = id && itemsById.get(id);
      return window.BANK_BUILD.keyOf([{ name: game ? game.name : v.name, itemId: id || null }], v.bonuses);
    };
    const equipped = new Set();
    stuff.items.forEach((slot) => slot.variants.forEach((v, i) => {
      if (!(slot === item && i === index)) equipped.add(keyOfVariant(v));
    }));
    const byKey = new Map();
    (cls ? cls.stuffs : []).filter((s) => s !== stuff).forEach((other) => other.items.forEach((slot) => {
      if (window.BANK_BUILD.categoryOf(slot.slot) !== category) return;
      slot.variants.forEach((v) => {
        const id = gameIdOf(v);
        const game = id && itemsById.get(id);
        const variant = { name: game ? game.name : v.name, itemId: id || null, bonuses: v.bonuses };
        const key = window.BANK_BUILD.keyOf([variant], v.bonuses);
        if (equipped.has(key)) return;
        if (!byKey.has(key)) byKey.set(key, { variant, status: "missing", stuffs: [] });
        const reuse = byKey.get(key);
        reuse.status = window.BANK_BUILD.bestStatus(reuse.status, v.status || "missing");
        if (!reuse.stuffs.includes(stuffLabel(other))) reuse.stuffs.push(stuffLabel(other));
      });
    }));
    return [...byKey.values()].sort((a, b) => a.variant.name.localeCompare(b.variant.name, "fr"));
  }

  function openPicker(stuff, item, index) {
    const replaced = item.variants[index];
    openItemPicker(item.slot + " — " + stuffLabel(stuff), {
      // Niveau saisi : le curseur part du premier objet de ce niveau (ou du niveau inférieur le plus proche).
      targetLevel: stuff.level || null,
      types: window.SLOTS.slotTypes(item.slot),
      selectedId: replaced && gameIdOf(replaced),
      reuses: characterReuses(stuff, item, index),
      // Lots réservés à ce personnage, en plus du stock commun (jamais ceux des autres personnages).
      stockOwner: (classes.find((c) => c.stuffs.includes(stuff)) || {}).id || null,
      stockCategory: window.BANK_BUILD.categoryOf(item.slot),
      // Même exemplaire que dans un autre stuff : objet, tags et état copiés, le stock n'est pas touché.
      onChooseReuse: (reuse) => {
        if (item.variants[index]) returnToStock(item, index);
        item.variants[index] = {
          name: reuse.variant.name,
          starred: false,
          itemId: reuse.variant.itemId,
          status: reuse.status,
          bonuses: copyBonuses(reuse.variant.bonuses),
        };
        scheduleSave();
        render();
      },
      onChoose: (gameItem) => {
        // Remplacer une variante : l'ancienne retourne au stock, la nouvelle est à obtenir.
        const replaced = item.variants[index];
        if (replaced) returnToStock(item, index);
        // La forgemagie visée pour cette position reste valable pour le nouvel objet.
        const bonuses = replaced ? replaced.bonuses.map((b) => ({ text: b.text, kind: b.kind })) : [];
        item.variants[index] = { name: gameItem.name, starred: false, itemId: gameItem.id, status: "missing", bonuses };
        scheduleSave();
        render();
      },
      // 1er objet : le lot remplace tout l'emplacement ; sinon il devient une variante.
      onChooseStock: (lot) => (index === 0 ? assignStock(item, lot) : assignStockVariant(item, index, lot)),
    });
  }

  function stockLabel(lot) {
    const plural = lot.quantity > 1 && lot.status !== "missing" ? "s" : "";
    return lot.quantity + " en stock · " + STATUS_SHORT[lot.status] + plural;
  }

  // initial : ouverture de la liste (placement du curseur selon l'objet actuel ou le niveau du stuff).
  function renderPickerList(selectedId, initial) {
    const query = normalize(pickerSearch.value.trim());
    const matching = pickerTarget.stockCategory
      ? stock.filter((lot) => lot.category === pickerTarget.stockCategory
        && (!lot.owner || lot.owner === pickerTarget.stockOwner)
        && (!query || normalize([...lot.variants.map((v) => v.name), ...lot.bonuses.map((b) => b.text)].join(" ")).includes(query)))
      : [];
    const ownLots = matching.filter((lot) => lot.owner);
    const commonLots = matching.filter((lot) => !lot.owner);
    const lots = [...ownLots, ...commonLots];
    const reuses = (pickerTarget.reuses || []).filter((r) => !query
      || normalize([r.variant.name, ...r.variant.bonuses.map((b) => b.text)].join(" ")).includes(query));
    const games = pickerOptions.filter((i) => !query || normalize(i.name).includes(query));
    // Options navigables, dans l'ordre d'affichage : objets du personnage, lots du stock, objets du jeu.
    const visible = [...reuses.map((reuse) => ({ reuse })), ...lots.map((lot) => ({ lot })), ...games.map((game) => ({ game }))];
    pickerActive = Math.max(0, visible.findIndex((o) => o.game && o.game.id === selectedId));
    // Liste triée par niveau décroissant : le premier objet de niveau ≤ au niveau du stuff.
    if (initial && !selectedId && pickerTarget.targetLevel) {
      const i = visible.findIndex((o) => o.game && o.game.level <= pickerTarget.targetLevel);
      if (i >= 0) pickerActive = i;
    }

    const optionEl = (o, i) => {
      const content = o.reuse
        ? [
          iconImg(o.reuse.variant),
          el("span", { class: "picker-name" }, [
            el("span", {}, [highlight(o.reuse.variant.name, query), legendaryStar(isLegendary(o.reuse.variant))]),
            o.reuse.variant.bonuses.length && el("span", { class: "picker-tags" }, o.reuse.variant.bonuses.map((b) => tagEl(b, query))),
          ]),
          el("span", { class: "picker-stock", "data-status": o.reuse.status, title: "Dans : " + o.reuse.stuffs.join(", "), text: STATUS_SHORT[o.reuse.status] + " · " + o.reuse.stuffs.join(", ") }),
        ]
        : o.lot
        ? [
          iconImg(o.lot.variants[0]),
          el("span", { class: "picker-name" }, [
            el("span", {}, [highlight(o.lot.variants.map((v) => v.name).join(" ou "), query), legendaryStar(isLegendary(o.lot.variants[0]))]),
            o.lot.bonuses.length && el("span", { class: "picker-tags" }, o.lot.bonuses.map((b) => tagEl(b, query))),
          ]),
          el("span", { class: "picker-stock", "data-status": o.lot.status, text: stockLabel(o.lot) }),
        ]
        : [
          el("img", { src: DOFUSDB_IMG_URL + o.game.iconId + ".png", alt: "", loading: "lazy" }),
          el("span", { class: "picker-name" }, [el("span", {}, [highlight(o.game.name, query), legendaryStar(o.game.legendary)])]),
          el("span", { class: "picker-level", text: "niv. " + o.game.level }),
        ];
      const option = el("li", { role: "option", class: "picker-option", "aria-selected": String(i === pickerActive) }, content);
      option.addEventListener("click", () => choose(o));
      option.addEventListener("mousemove", () => setActive(i));
      return option;
    };

    const nodes = [];
    const group = (text) => el("li", { class: "picker-group", role: "presentation", text });
    let n = 0;
    if (reuses.length) nodes.push(group("Déjà sur le personnage"));
    reuses.forEach(() => { nodes.push(optionEl(visible[n], n)); n += 1; });
    if (ownLots.length) nodes.push(group("Stock du personnage"));
    ownLots.forEach(() => { nodes.push(optionEl(visible[n], n)); n += 1; });
    if (commonLots.length) nodes.push(group(ownLots.length ? "Stock commun" : "Dans le stock"));
    commonLots.forEach(() => { nodes.push(optionEl(visible[n], n)); n += 1; });
    if ((reuses.length || lots.length) && games.length) nodes.push(group("Tous les objets"));
    games.forEach(() => { nodes.push(optionEl(visible[n], n)); n += 1; });
    if (!visible.length) nodes.push(el("li", { class: "picker-empty", text: "Aucun objet trouvé." }));
    pickerList.replaceChildren(...nodes);
    pickerList.visible = visible;
    scrollActiveIntoView();
  }

  function setActive(i) {
    const options = pickerList.querySelectorAll(".picker-option");
    if (!options.length) return;
    pickerActive = (i + options.length) % options.length;
    options.forEach((o, j) => o.setAttribute("aria-selected", String(j === pickerActive)));
  }

  function scrollActiveIntoView() {
    const option = pickerList.querySelectorAll(".picker-option")[pickerActive];
    if (option) option.scrollIntoView({ block: "nearest" });
  }

  function choose(option) {
    picker.close();
    if (option.reuse) pickerTarget.onChooseReuse(option.reuse);
    else if (option.lot) pickerTarget.onChooseStock(option.lot);
    else pickerTarget.onChoose(option.game);
  }

  // La variante retirée d'un emplacement, si elle est fabriquée ou possédée, retourne dans le stock du personnage
  // (avec ses tags et son état).
  function returnToStock(item, index) {
    const variant = item.variants[index];
    if (!variant || variant.status === "missing") return;
    const id = gameIdOf(variant);
    const game = id && itemsById.get(id);
    // L'objet est dans l'inventaire du personnage : il va dans son stock (et non le stock commun).
    const cls = classes.find((c) => c.stuffs.some((s) => s.items.includes(item)));
    const owner = cls ? cls.id : null;
    const data = {
      category: window.BANK_BUILD.categoryOf(item.slot),
      variants: [{ name: game ? game.name : variant.name, itemId: id || null }],
      bonuses: variant.bonuses.map((b) => ({ text: b.text, kind: b.kind })),
      status: variant.status,
    };
    if (owner) data.owner = owner;
    const key = window.BANK_BUILD.keyOf(data.variants, data.bonuses);
    const same = stock.find((l) => l.status === data.status && (l.owner || null) === owner
      && window.BANK_BUILD.keyOf(l.variants, l.bonuses) === key);
    if (same) same.quantity += 1;
    else stock.push(Object.assign({ id: newStockId(), quantity: 1 }, data));
    scheduleSave("stock");
  }

  function copyBonuses(bonuses) {
    return bonuses.map((b) => ({ text: b.text, kind: b.kind }));
  }

  function takeFromStock(lot) {
    lot.quantity -= 1;
    if (!lot.quantity) stock.splice(stock.indexOf(lot), 1);
  }

  // Attribue un exemplaire du stock comme variante : elle prend les tags et l'état du lot.
  function assignStockVariant(item, index, lot) {
    const v = lot.variants[0];
    if (item.variants[index]) returnToStock(item, index);
    item.variants[index] = { name: v.name, starred: false, itemId: v.itemId, status: lot.status, bonuses: copyBonuses(lot.bonuses) };
    takeFromStock(lot);
    scheduleSave("stuffs");
    scheduleSave("stock");
    render();
  }

  // Attribue un exemplaire du stock à un emplacement : objet, tags et état sont copiés.
  function assignStock(item, lot) {
    item.variants.forEach((_, i) => returnToStock(item, i));
    item.variants = lot.variants.map((v) => ({ name: v.name, starred: false, itemId: v.itemId, status: lot.status, bonuses: copyBonuses(lot.bonuses) }));
    takeFromStock(lot);
    scheduleSave("stuffs");
    scheduleSave("stock");
    render();
  }

  pickerSearch.addEventListener("input", () => renderPickerList());
  pickerSearch.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(pickerActive + (e.key === "ArrowDown" ? 1 : -1));
      scrollActiveIntoView();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = pickerList.visible[pickerActive];
      if (option) choose(option);
    }
  });
  picker.addEventListener("click", (e) => { if (e.target === picker) picker.close(); });
  document.getElementById("picker-close").addEventListener("click", () => picker.close());

  // --- Dossiers : changer, créer, modifier, supprimer ---------------------------
  const folderBtn = document.getElementById("folder-btn");
  const foldersDialog = document.getElementById("folders-dialog");
  const folderDialog = document.getElementById("folder-dialog");
  const folderForm = document.getElementById("folder-form");
  let folderTarget = null; // dossier modifié, ou null pour une création

  function folderLabel(f) {
    return f.server && normalize(f.server) !== normalize(f.name) ? f.name + " · " + f.server : f.name;
  }

  // Les vues générales (#banque, #tags, #historique) sont gardées ; un personnage n'existe que dans son dossier.
  async function openFolder(id) {
    await flushSaves();
    const keep = ["#banque", "#tags", "#historique"].includes(location.hash) ? location.hash : "";
    location.href = location.pathname + "?dossier=" + encodeURIComponent(id) + keep;
  }

  async function folderRequest(body) {
    await flushSaves();
    const res = await fetch("api/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "HTTP " + res.status);
    return data;
  }

  function renderFoldersDialog() {
    document.getElementById("folders-list").replaceChildren(...folders.map((f) => {
      const actions = [];
      if (f !== folder) {
        const open = el("button", { type: "button", class: "btn btn-small btn-primary", text: "Ouvrir" });
        open.addEventListener("click", () => openFolder(f.id));
        actions.push(open);
      } else {
        actions.push(el("span", { class: "folder-current", text: "Ouvert" }));
      }
      if (editing) {
        const edit = el("button", { type: "button", class: "btn btn-small", text: "Modifier" });
        edit.addEventListener("click", () => openFolderForm(f));
        actions.push(edit);
        if (folders.length > 1) {
          const remove = el("button", { type: "button", class: "btn btn-small btn-danger", text: "Supprimer" });
          remove.addEventListener("click", async () => {
            if (!confirm("Supprimer le dossier « " + f.name + " » ?\nSes personnages, stuffs, stock et historique seront déplacés dans data/corbeille/.")) return;
            try {
              await folderRequest({ action: "delete", id: f.id });
              if (f === folder) await openFolder(folders.find((x) => x !== f).id);
              else location.reload();
            } catch (err) { alert("Suppression impossible : " + err.message); }
          });
          actions.push(remove);
        }
      }
      return el("li", { class: "folder-row" + (f === folder ? " current" : "") }, [
        el("div", {}, [el("strong", { text: f.name }), f.server ? el("span", { class: "folder-server", text: "Serveur : " + f.server }) : null]),
        el("div", { class: "folder-row-actions" }, actions),
      ]);
    }));
    const actions = document.getElementById("folders-actions");
    actions.replaceChildren();
    if (editing) {
      const add = el("button", { type: "button", class: "btn btn-primary", text: "+ Nouveau dossier" });
      add.addEventListener("click", () => openFolderForm(null));
      actions.append(add);
    } else if (canSave) {
      actions.append(el("span", { class: "tag-summary", text: "« Modifier » pour créer, renommer ou supprimer un dossier." }));
    }
  }

  function openFolderForm(f) {
    folderTarget = f;
    document.getElementById("folder-dialog-title").textContent = f ? "Modifier le dossier" : "Nouveau dossier";
    document.getElementById("folder-form-submit").textContent = f ? "Enregistrer" : "Créer le dossier";
    folderForm.elements.name.value = f ? f.name : "";
    folderForm.elements.server.value = f ? f.server || "" : "";
    folderForm.querySelector(".form-error").textContent = "";
    folderDialog.showModal();
    folderForm.elements.name.focus();
  }

  folderForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = folderForm.elements.name.value.trim();
    const server = folderForm.elements.server.value.trim();
    if (folders.some((f) => f !== folderTarget && normalize(f.name) === normalize(name))) {
      folderForm.querySelector(".form-error").textContent = "Un dossier s'appelle déjà « " + name + " ».";
      return;
    }
    try {
      if (folderTarget) {
        await folderRequest({ action: "update", id: folderTarget.id, name, server });
        location.reload();
      } else {
        const { id } = await folderRequest({ action: "create", name, server });
        await openFolder(id);
      }
    } catch (err) {
      folderForm.querySelector(".form-error").textContent = err.message;
    }
  });

  [foldersDialog, folderDialog].forEach((dialog) => {
    dialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dialog.close()));
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  });

  if (folder) {
    folderBtn.replaceChildren(el("span", { class: "folder-icon", text: "📁" }), el("span", { text: folderLabel(folder) }), el("span", { class: "folder-caret", text: "▾" }));
    folderBtn.addEventListener("click", () => { renderFoldersDialog(); foldersDialog.showModal(); });
    document.title = "Stuffs — " + folder.name;
  } else {
    folderBtn.hidden = true;
  }

  // --- Personnages : ajout / modification / suppression -----------------------
  const characterDialog = document.getElementById("character-dialog");
  const characterForm = document.getElementById("character-form");
  let characterTarget = null; // personnage modifié, ou null pour un ajout

  characterForm.elements.class.append(...GAME_CLASSES.map((c) => el("option", { value: c, text: c })));
  characterForm.elements.class.addEventListener("change", () => {
    document.getElementById("character-icon").src = classIcon(characterForm.elements.class.value);
    characterForm.elements.name.placeholder = characterForm.elements.class.value;
  });

  function openCharacterForm(cls) {
    characterTarget = cls;
    document.getElementById("character-dialog-title").textContent = cls ? "Modifier le personnage" : "Nouveau personnage";
    document.getElementById("character-form-submit").textContent = cls ? "Enregistrer" : "Créer le personnage";
    characterForm.elements.class.value = cls ? gameClassOf(cls.class) || GAME_CLASSES[0] : GAME_CLASSES[0];
    characterForm.elements.class.dispatchEvent(new Event("change"));
    // Nom affiché vide = nom de la classe.
    characterForm.elements.name.value = cls && cls.name !== cls.class ? cls.name : "";
    characterForm.querySelector(".form-error").textContent = "";
    characterDialog.showModal();
    characterForm.elements.name.focus();
  }

  characterForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const gameClass = characterForm.elements.class.value;
    const name = characterForm.elements.name.value.trim() || gameClass;
    // Le nom affiché identifie le personnage dans l'adresse et la banque : il doit être unique.
    if (classes.some((c) => c !== characterTarget && normalize(c.name) === normalize(name))) {
      characterForm.querySelector(".form-error").textContent = "Un personnage s'appelle déjà « " + name + " ».";
      return;
    }
    if (characterTarget) {
      Object.assign(characterTarget, { name, class: gameClass, icon: classIcon(gameClass) });
    } else {
      classes.push({ id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, class: gameClass, icon: classIcon(gameClass), stuffs: [] });
    }
    characterDialog.close();
    current = name;
    location.hash = encodeURIComponent(name);
    scheduleSave();
    render();
  });
  characterDialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => characterDialog.close()));
  characterDialog.addEventListener("click", (e) => { if (e.target === characterDialog) characterDialog.close(); });

  function deleteCharacter(cls) {
    const n = cls.stuffs.length;
    const own = stock.filter((l) => l.owner === cls.id);
    const parts = [n && n + " stuff" + (n > 1 ? "s" : ""), own.length && "son stock (" + own.length + " objet" + (own.length > 1 ? "s" : "") + ")"].filter(Boolean);
    if (!confirm("Supprimer le personnage « " + cls.name + " »" + (parts.length ? " avec " + parts.join(" et ") : "") + " ?"
      + "\nL'historique permet d'annuler la suppression.")) return;
    classes.splice(classes.indexOf(cls), 1);
    if (own.length) {
      own.forEach((l) => stock.splice(stock.indexOf(l), 1));
      scheduleSave("stock");
    }
    current = classes[0] && classes[0].name;
    location.hash = current ? encodeURIComponent(current) : "";
    scheduleSave();
    render();
  }

  // Bloc repliable (clic sur son titre) ; ouvert ou replié, il le reste d'une visite à l'autre.
  function collapsible(name, className, summaryChildren, body) {
    const key = "tracking-stuff:" + name + "-open";
    const box = el("details", { class: "stuff collapsible " + className }, [el("summary", {}, summaryChildren), ...body]);
    box.open = load(key, "open") === "open";
    box.addEventListener("toggle", () => {
      try { localStorage.setItem(key, JSON.stringify(box.open ? "open" : "closed")); } catch (e) { /* stockage indisponible */ }
    });
    return box;
  }

  // Bloc « Stock de <personnage> » : objets réservés à ce personnage.
  function renderCharacterStock(cls, query) {
    const lots = stock.filter((l) => l.owner === cls.id)
      .filter((l) => !query || normalize([l.category, ...l.variants.map((v) => v.name), ...l.bonuses.map((b) => b.text)].join(" ")).includes(query))
      .sort((a, b) => window.BANK_BUILD.CATEGORIES.indexOf(a.category) - window.BANK_BUILD.CATEGORIES.indexOf(b.category)
        || a.variants[0].name.localeCompare(b.variants[0].name, "fr"));

    const total = lots.reduce((n, l) => n + l.quantity, 0);
    const summary = [
      el("h3", { text: "Stock de " + cls.name }),
      el("span", { class: "meta", text: total ? total + " objet" + (total > 1 ? "s" : "") + " réservé" + (total > 1 ? "s" : "") + " à ce personnage" : "Aucun objet réservé à ce personnage" }),
    ];
    if (editing) {
      const add = el("button", { type: "button", class: "btn btn-small btn-primary", text: "+ Ajouter au stock" });
      add.addEventListener("click", (e) => {
        e.preventDefault(); // sans replier le bloc
        openStockForm(null, { owner: cls.id });
      });
      summary.splice(1, 0, add);
    }
    // Une section par catégorie, les objets en cases côte à côte.
    const sections = window.BANK_BUILD.CATEGORIES
      .map((category) => [category, lots.filter((l) => l.category === category)])
      .filter(([, list]) => list.length)
      .map(([category, list]) => el("section", { class: "char-stock-group" }, [
        el("h4", { class: "group-title", text: category }),
        el("ul", { class: "stock-tiles" }, list.map((lot) => renderStockTile(lot, query))),
      ]));
    return collapsible("char-stock", "char-stock", summary, sections);
  }

  // Case d'un objet du stock : icône + nom ; quantité, état et tags dans l'infobulle.
  function renderStockTile(lot, query) {
    const variant = lot.variants[0];
    const tags = lot.bonuses.map((b) => (b.kind === "removed" ? "−" : "") + b.text);
    const title = [
      variant.name + (isLegendary(variant) ? " (légendaire)" : ""),
      "Quantité : " + lot.quantity + " · " + STATUS_SHORT[lot.status] + (lot.quantity > 1 && lot.status !== "missing" ? "s" : ""),
      tags.length ? "Tags : " + tags.join(", ") : "Sans tag",
    ].join("\n");
    // L'infobulle de l'icône (nom, niveau) masquerait celle de la case.
    const icon = iconImg(variant);
    icon.removeAttribute("title");
    const content = [
      icon,
      el("span", { class: "stock-tile-name" }, [highlight(variant.name, query), legendaryStar(isLegendary(variant))]),
      lot.quantity > 1 ? el("span", { class: "stock-tile-qty", text: "×" + lot.quantity }) : null,
      tags.length ? el("span", { class: "stock-tile-tagged", "aria-hidden": "true", text: "◆" }) : null,
    ];
    if (!editing) return el("li", { class: "stock-tile", "data-status": lot.status, title }, content);

    const edit = el("button", { type: "button", class: "stock-tile-main", title: title + "\n\nClic : modifier" }, content);
    edit.addEventListener("click", () => openStockForm(lot));
    const remove = el("button", { type: "button", class: "stock-tile-remove", title: "Retirer du stock", "aria-label": "Retirer " + variant.name + " du stock", text: "×" });
    remove.addEventListener("click", () => {
      if (!confirm("Retirer " + lot.quantity + " × « " + variant.name + " » du stock ?")) return;
      stock.splice(stock.indexOf(lot), 1);
      scheduleSave("stock");
      render();
    });
    return el("li", { class: "stock-tile editable", "data-status": lot.status }, [edit, remove]);
  }

  // --- Parchottage ---------------------------------------------------------------
  // Chaque statistique va de 0 à 100 ; chaque palier se monte avec sa taille de parchemin.
  const SCROLL_STATS = [
    ["vitality", "Vitalité"], ["strength", "Force"], ["intelligence", "Intelligence"],
    ["chance", "Chance"], ["agility", "Agilité"], ["wisdom", "Sagesse"],
  ];
  const SCROLL_TIERS = [
    { key: "small", label: "Petits", from: 0, to: 25, gain: 1, genetons: 10, doplons: 20 },
    { key: "medium", label: "Normaux", from: 25, to: 50, gain: 1, genetons: 30, doplons: 60 },
    { key: "large", label: "Grands", from: 50, to: 80, gain: 1, genetons: 70, doplons: 140 },
    { key: "powerful", label: "Puissants", from: 80, to: 100, gain: 2, genetons: 170, doplons: 340 },
  ];
  const SCROLL_MAX = 100;
  const scrollItems = window.DOFUS_SCROLLS || {};

  function scrollValue(cls, stat) {
    return (cls.scrolls && cls.scrolls[stat]) || 0;
  }

  // Parchemins de ce palier encore à consommer pour atteindre 100.
  function scrollsNeeded(value, tier) {
    return Math.ceil(Math.max(0, tier.to - Math.max(value, tier.from)) / tier.gain);
  }

  // Note renseignée à la main dans data/scroll-notes.js, en haut à droite des blocs de parchemins.
  function scrollNoteEl() {
    const text = (window.SCROLL_NOTE || "").trim();
    return text ? el("span", { class: "scroll-note" }, noteParts(text)) : null;
  }

  function scrollCount(n) {
    return n + " parchemin" + (n > 1 ? "s" : "");
  }

  // Prix d'achat : en génétons ou en doplons. counts : nombre de parchemins par palier.
  function scrollCost(counts) {
    return SCROLL_TIERS.reduce((cost, tier, i) => ({
      genetons: cost.genetons + counts[i] * tier.genetons,
      doplons: cost.doplons + counts[i] * tier.doplons,
    }), { genetons: 0, doplons: 0 });
  }

  function formatNumber(n) {
    return n.toLocaleString("fr-FR");
  }

  function costText(cost) {
    return formatNumber(cost.genetons) + " génétons ou " + formatNumber(cost.doplons) + " doplons";
  }

  function costEl(cost) {
    return el("span", { class: "scroll-cost" }, [
      el("span", { class: "cost-geneton", text: formatNumber(cost.genetons) + " gén." }),
      el("span", { class: "cost-sep", text: "ou" }),
      el("span", { class: "cost-doplon", text: formatNumber(cost.doplons) + " dop." }),
    ]);
  }

  function renderCharacterScrolls(cls) {
    const meta = el("span", { class: "meta" });
    const totals = el("div", { class: "scroll-totals" });
    const rows = SCROLL_STATS.map(([stat, label]) => renderScrollRow(cls, stat, label, refresh));

    // Total restant, par taille de parchemin.
    function refresh() {
      const left = SCROLL_TIERS.map((tier) => SCROLL_STATS.reduce((n, [stat]) => n + scrollsNeeded(scrollValue(cls, stat), tier), 0));
      const total = left.reduce((a, b) => a + b, 0);
      meta.textContent = total ? scrollCount(total) + " restant" + (total > 1 ? "s" : "") + " pour tout monter à 100" : "Parchotté à 100 partout";
      totals.replaceChildren(...[el("span", { text: "Restant :" }), ...SCROLL_TIERS.map((tier, i) => el("span", { class: "scroll-total" + (left[i] ? "" : " done") }, [
        el("span", { class: "scroll-total-label", text: tier.label }),
        el("strong", { text: String(left[i]) }),
      ])), total ? el("span", { class: "scroll-total-cost", title: "Prix des parchemins restants : " + costText(scrollCost(left)) }, [
        el("span", { text: "Coût :" }), costEl(scrollCost(left)),
      ]) : null].filter(Boolean));
    }
    refresh();

    const scale = el("div", { class: "scroll-row scroll-scale", "aria-hidden": "true" }, [
      el("span"),
      el("div", { class: "scroll-scale-marks" }, [0, ...SCROLL_TIERS.map((t) => t.to)].map((v) => el("span", { style: "left:" + v + "%", text: String(v) }))),
      el("span"),
      el("div", { class: "scroll-needs" }, SCROLL_TIERS.map((t) => el("span", { text: t.label }))),
    ]);
    return collapsible("char-scrolls", "char-scrolls", [el("h3", { text: "Parchottage" }), meta, scrollNoteEl()], [el("div", { class: "scroll-rows" }, [scale, ...rows]), totals]);
  }

  function renderScrollRow(cls, stat, label, onChange) {
    const fill = el("span", { class: "scroll-fill" });
    const gauge = el("div", {
      class: "scroll-gauge", role: "slider", tabindex: canSave ? "0" : "-1",
      "aria-label": label, "aria-valuemin": "0", "aria-valuemax": String(SCROLL_MAX),
    }, [fill, ...SCROLL_TIERS.slice(0, -1).map((t) => el("span", { class: "scroll-mark", style: "left:" + t.to + "%" }))]);
    const input = el("input", { type: "number", class: "scroll-input", min: "0", max: String(SCROLL_MAX), step: "1", "aria-label": label + " (parchottage)" });
    if (!canSave) input.disabled = true;
    const needs = el("div", { class: "scroll-needs" });
    const row = el("div", { class: "scroll-row", "data-stat": stat }, [el("span", { class: "scroll-stat", text: label }), gauge, input, needs]);

    function show() {
      const value = scrollValue(cls, stat);
      fill.style.width = value + "%";
      gauge.setAttribute("aria-valuenow", String(value));
      gauge.title = label + " : " + value + " / " + SCROLL_MAX;
      if (document.activeElement !== input) input.value = String(value);
      row.classList.toggle("done", value >= SCROLL_MAX);
      needs.replaceChildren(...SCROLL_TIERS.map((tier) => {
        const n = scrollsNeeded(value, tier);
        const item = scrollItems[stat] && scrollItems[stat][tier.key];
        const name = item ? item.name : tier.label + " parchemins de " + label;
        const content = [
          item ? el("img", { src: item.icon, alt: "" }) : null,
          el("span", { text: n ? "×" + n : "✓" }),
        ];
        const title = n
          ? n + " × " + name + " (" + tier.from + " → " + tier.to + ", +" + tier.gain + " chacun)\nPrix : " + costText({ genetons: n * tier.genetons, doplons: n * tier.doplons })
          : name + " : palier terminé";
        if (!n || !canSave) return el("span", { class: "scroll-need" + (n ? "" : " done"), title }, content);
        // Clic : parchemins du palier consommés, la statistique passe à la fin du palier.
        const btn = el("button", { type: "button", class: "scroll-need", title: title + "\nClic : consommés → " + label + " à " + tier.to }, content);
        btn.addEventListener("click", () => set(tier.to));
        return btn;
      }));
    }

    function set(value) {
      value = Math.max(0, Math.min(SCROLL_MAX, Math.round(value)));
      if (value === scrollValue(cls, stat)) return;
      cls.scrolls = Object.assign({}, cls.scrolls, { [stat]: value });
      show();
      onChange();
      scheduleSave();
    }

    if (canSave) {
      // Clic ou glisser sur la jauge.
      const fromPointer = (e) => {
        const rect = gauge.getBoundingClientRect();
        set(((e.clientX - rect.left) / rect.width) * SCROLL_MAX);
      };
      gauge.addEventListener("pointerdown", (e) => {
        gauge.setPointerCapture(e.pointerId);
        fromPointer(e);
      });
      gauge.addEventListener("pointermove", (e) => { if (gauge.hasPointerCapture(e.pointerId)) fromPointer(e); });
      // Flèches : ±1 ; Page haut / bas : palier suivant / précédent ; Début / Fin : 0 / 100.
      gauge.addEventListener("keydown", (e) => {
        const value = scrollValue(cls, stat);
        const marks = [0, ...SCROLL_TIERS.map((t) => t.to)];
        const next = {
          ArrowRight: value + 1, ArrowUp: value + 1, ArrowLeft: value - 1, ArrowDown: value - 1,
          PageUp: marks.find((m) => m > value), PageDown: [...marks].reverse().find((m) => m < value),
          Home: 0, End: SCROLL_MAX,
        }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        set(next);
      });
      input.addEventListener("input", () => { if (input.value !== "") set(Number(input.value)); });
      input.addEventListener("change", show);
    }
    show();
    return row;
  }

  // Liste de courses : parchemins restants de tous les personnages du dossier.

  function renderScrollShopping() {
    const rows = SCROLL_STATS.map(([stat, label]) => {
      const cells = SCROLL_TIERS.map((tier) => {
        const perChar = classes.map((cls) => [cls, scrollsNeeded(scrollValue(cls, stat), tier)]).filter(([, n]) => n);
        return { tier, perChar, total: perChar.reduce((a, [, n]) => a + n, 0) };
      });
      return { stat, label, cells, total: cells.reduce((a, c) => a + c.total, 0) };
    });
    const total = rows.reduce((a, r) => a + r.total, 0);
    const tierTotals = SCROLL_TIERS.map((t, j) => rows.reduce((a, r) => a + r.cells[j].total, 0));
    const cost = scrollCost(tierTotals);
    const ROW_CLASS = [" first", " cost-row-geneton", " cost-row-doplon"];

    const table = el("div", { class: "shopping-grid" }, [
      el("span"),
      ...SCROLL_TIERS.map((t) => el("span", { class: "shopping-col", text: t.label })),
      el("span", { class: "shopping-col", text: "Total" }),
      ...rows.filter((r) => r.total).flatMap((r) => [
        el("span", { class: "scroll-stat shopping-stat", "data-stat": r.stat, text: r.label }),
        ...r.cells.map((cell) => {
          const item = scrollItems[r.stat] && scrollItems[r.stat][cell.tier.key];
          if (!cell.total) return el("span", { class: "shopping-cell done", text: "—" });
          const title = (item ? item.name : cell.tier.label + " parchemins de " + r.label) + " : " + cell.total + "\n"
            + cell.perChar.map(([cls, n]) => "• " + cls.name + " : " + n).join("\n")
            + "\nPrix : " + costText({ genetons: cell.total * cell.tier.genetons, doplons: cell.total * cell.tier.doplons });
          return el("span", { class: "shopping-cell", title }, [
            item ? el("img", { src: item.icon, alt: "" }) : null,
            el("strong", { text: "×" + cell.total }),
            el("span", { class: "shopping-who" }, cell.perChar.map(([cls]) => el("img", { src: classIcon(cls.class), alt: cls.name }))),
          ]);
        }),
        el("strong", { class: "shopping-row-total", title: r.label + " : " + costText(scrollCost(r.cells.map((c) => c.total))), text: String(r.total) }),
      ]),
      // Totaux par palier, puis leur prix en génétons et en doplons.
      ...[
        ["Total", (n) => String(n), (n) => String(n)],
        ["Génétons", (n, t) => formatNumber(n * t.genetons), () => formatNumber(cost.genetons)],
        ["Doplons", (n, t) => formatNumber(n * t.doplons), () => formatNumber(cost.doplons)],
      ].flatMap(([label, cell, sum], i) => [
        el("span", { class: "shopping-foot-label" + (i ? "" : " first"), text: label }),
        ...SCROLL_TIERS.map((t, j) => el("span", { class: "shopping-foot" + ROW_CLASS[i] + (tierTotals[j] ? "" : " done"), text: tierTotals[j] ? cell(tierTotals[j], t) : "—" })),
        el("strong", { class: "shopping-foot shopping-row-total" + ROW_CLASS[i], text: sum(total) }),
      ]),
    ]);

    const summary = [
      el("h3", { text: "Liste de courses — parchemins" }),
      el("span", { class: "meta", text: total
        ? scrollCount(total) + " pour monter " + (classes.length > 1 ? "tous les personnages" : "le personnage") + " à 100 · " + costText(cost)
        : "Tous les personnages sont parchottés à 100" }),
    ];
    return collapsible("scroll-shopping", "scroll-shopping", [...summary, scrollNoteEl()], total ? [table] : []);
  }

  // --- Sorts communs -------------------------------------------------------------
  // Une ligne par paire de variantes : débloquer un sort débloque aussi sa variante.
  const spellPairs = (window.COMMON_SPELLS && window.COMMON_SPELLS.pairs) || [];
  // Moyen d'obtention de chaque paire, renseigné à la main dans data/spell-notes.js : { <id de paire> : texte }.
  const spellNotes = window.SPELL_NOTES || {};

  // Moyen d'obtention d'une paire, sous sa ligne (rien s'il n'est pas renseigné).
  function spellNoteEl(pair) {
    const text = (spellNotes[pair.id] || "").trim();
    return text ? el("p", { class: "spell-note" }, noteParts(text)) : null;
  }

  // Texte d'une note : [[texte]] ou [[libellé|texte à copier]] devient une étiquette qui copie au clic.
  function noteParts(text) {
    const parts = [];
    let last = 0;
    for (const match of text.matchAll(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g)) {
      parts.push(text.slice(last, match.index));
      const label = match[1].trim();
      parts.push(copyChip(label, (match[2] || match[1]).trim()));
      last = match.index + match[0].length;
    }
    parts.push(text.slice(last));
    return parts.filter(Boolean);
  }

  function copyChip(label, value) {
    const chip = el("button", { type: "button", class: "copy-chip", title: "Copier : " + value }, [
      el("span", { class: "copy-chip-label", text: label }),
      el("span", { class: "copy-chip-icon", "aria-hidden": "true", text: "⧉" }),
    ]);
    let timer = null;
    chip.addEventListener("click", async (e) => {
      // Sans cocher la ligne d'un sort ni replier le bloc dont le titre la contient.
      e.preventDefault();
      e.stopPropagation();
      const ok = await copyText(value);
      chip.classList.toggle("copied", ok);
      chip.classList.toggle("copy-failed", !ok);
      chip.querySelector(".copy-chip-icon").textContent = ok ? "✓" : "✗";
      clearTimeout(timer);
      timer = setTimeout(() => {
        chip.classList.remove("copied", "copy-failed");
        chip.querySelector(".copy-chip-icon").textContent = "⧉";
      }, 1500);
    });
    return chip;
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (err) {
      // Repli (page ouverte en file:// par exemple).
      const area = el("textarea", { readonly: "", style: "position:fixed;opacity:0" });
      area.value = value;
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  }

  function hasSpellPair(cls, pair) {
    return (cls.commonSpells || []).includes(pair.id);
  }

  function setSpellPair(cls, pair, unlocked) {
    const ids = new Set(cls.commonSpells || []);
    if (unlocked) ids.add(pair.id); else ids.delete(pair.id);
    // Rangées dans l'ordre du tableau, pour un fichier stable.
    cls.commonSpells = spellPairs.map((p) => p.id).filter((id) => ids.has(id));
    scheduleSave();
  }

  function renderCharacterSpells(cls) {
    if (!spellPairs.length) return null;
    const meta = el("span", { class: "meta" });
    const refresh = () => {
      const n = spellPairs.filter((p) => hasSpellPair(cls, p)).length;
      meta.textContent = n + " / " + spellPairs.length + " variantes débloquées";
    };
    const head = el("div", { class: "spell-row spell-head", "aria-hidden": "true" }, [
      el("span"), el("span", { text: "Sort" }), el("span", { text: "Variante" }),
    ]);
    const rows = spellPairs.map((pair) => renderSpellRow(cls, pair, refresh));
    refresh();
    return collapsible("char-spells", "char-spells", [el("h3", { text: "Sorts communs" }), meta], [el("div", { class: "spell-rows" }, [head, ...rows])]);
  }

  function renderSpellRow(cls, pair, onChange) {
    const toggle = el("button", { type: "button", class: "status-toggle" });
    const names = pair.spells.map((s) => s.name).join(" / ");
    const row = el("div", { class: "spell-row" }, [
      toggle,
      ...pair.spells.map((spell) => el("span", { class: "spell" }, [
        el("img", { src: spell.icon, alt: "", loading: "lazy" }),
        el("span", { class: "spell-name", text: spell.name }),
        spell.level ? el("span", { class: "spell-level", text: "niv. " + spell.level }) : null,
      ])),
      spellNoteEl(pair),
    ]);
    const show = () => {
      const unlocked = hasSpellPair(cls, pair);
      row.dataset.status = unlocked ? "owned" : "missing";
      toggle.dataset.status = row.dataset.status;
      toggle.setAttribute("aria-pressed", String(unlocked));
      toggle.setAttribute("aria-label", names + (unlocked ? " : débloqués" : " : non débloqués"));
      toggle.title = (unlocked ? "Débloqués" : "Non débloqués") + (canSave ? "\nClic : " + (unlocked ? "retirer" : "débloquer") : "");
    };
    if (canSave) {
      // Toute la ligne est cliquable.
      row.classList.add("clickable");
      row.addEventListener("click", () => {
        setSpellPair(cls, pair, !hasSpellPair(cls, pair));
        show();
        onChange();
      });
    } else {
      toggle.disabled = true;
    }
    show();
    return row;
  }

  // Sorts communs à récupérer : pour chaque paire, les personnages du dossier qui ne l'ont pas.
  function renderSpellsToUnlock() {
    if (!spellPairs.length) return null;
    const rows = spellPairs
      .map((pair) => ({ pair, missing: classes.filter((cls) => !hasSpellPair(cls, pair)) }))
      .filter((r) => r.missing.length);
    const total = rows.reduce((n, r) => n + r.missing.length, 0);

    const list = el("div", { class: "spells-todo" }, rows.map(({ pair, missing }) => el("div", { class: "spells-todo-row" }, [
      el("span", { class: "spells-todo-icons" }, pair.spells.map((s) => el("img", { src: s.icon, alt: "", loading: "lazy" }))),
      el("span", { class: "spells-todo-name" }, [
        el("span", { class: "spell-name", text: pair.spells.map((s) => s.name).join(" / ") }),
        pair.spells[0].level ? el("span", { class: "spell-level", text: "niv. " + pair.spells[0].level }) : null,
      ]),
      el("span", { class: "spells-todo-who" }, missing.map((cls) => el("img", { src: classIcon(cls.class), alt: cls.name, title: cls.name }))),
      el("strong", {
        class: "spells-todo-count",
        title: "À débloquer pour :\n" + missing.map((cls) => "• " + cls.name).join("\n"),
        text: missing.length + " / " + classes.length,
      }),
      spellNoteEl(pair),
    ])));

    const summary = [
      el("h3", { text: "Sorts communs à récupérer" }),
      el("span", { class: "meta", text: total
        ? total + " variante" + (total > 1 ? "s" : "") + " à débloquer sur l'ensemble des personnages"
        : "Tous les personnages ont tous les sorts communs" }),
    ];
    return collapsible("spells-todo", "spells-todo-box", summary, total ? [list] : []);
  }

  function renderCharacterHead(cls) {
    const subtitle = [cls.name !== cls.class ? cls.class : null, cls.stuffs.map(stuffLabel).join(" · ")].filter(Boolean).join(" — ");
    const title = el("div", { class: "character-title" }, [el("h2", { text: cls.name })]);
    if (editing) {
      const edit = el("button", { type: "button", class: "btn btn-small", text: "Modifier" });
      edit.addEventListener("click", () => openCharacterForm(cls));
      const remove = el("button", { type: "button", class: "btn btn-small btn-danger", text: "Supprimer" });
      remove.addEventListener("click", () => deleteCharacter(cls));
      title.append(edit, remove);
    }
    return el("div", { class: "class-head" }, [
      el("img", { src: classIcon(cls.class), alt: cls.class }),
      el("div", {}, [title, el("p", { text: subtitle })]),
    ]);
  }

  // --- Création / modification d'un stuff -----------------------------------
  const stuffDialog = document.getElementById("stuff-dialog");
  const stuffForm = document.getElementById("stuff-form");
  const stuffFormError = document.getElementById("stuff-form-error");
  let stuffTarget = null; // { cls, stuff } — stuff absent pour une création

  function openStuffForm(cls, stuff) {
    stuffTarget = { cls, stuff };
    document.getElementById("stuff-dialog-title").textContent = stuff ? "Modifier le stuff" : "Nouveau stuff — " + cls.name;
    document.getElementById("stuff-form-submit").textContent = stuff ? "Enregistrer" : "Créer le stuff";
    stuffForm.elements.name.value = stuff ? stuff.name : "";
    stuffForm.elements.level.value = stuff && stuff.level != null ? stuff.level : "";
    stuffForm.elements.initiative.value = stuff && stuff.initiative != null ? stuff.initiative : "";
    stuffForm.elements.link.value = stuff && stuff.link ? stuff.link : "";
    stuffFormError.textContent = "";
    stuffDialog.showModal();
    stuffForm.elements.name.focus();
  }

  stuffForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const { cls, stuff } = stuffTarget;
    const name = stuffForm.elements.name.value.trim();
    const initiative = stuffForm.elements.initiative.value.trim();
    const level = stuffForm.elements.level.value.trim();
    // Le nom identifie le stuff dans sa classe (cases « obtenu »).
    if (cls.stuffs.some((s) => s !== stuff && normalize(s.name) === normalize(name))) {
      stuffFormError.textContent = "Un stuff « " + name + " » existe déjà pour " + cls.name + ".";
      return;
    }
    const info = {
      name,
      level: level === "" ? null : Math.min(200, Math.max(1, Math.round(Number(level)))),
      initiative: initiative === "" ? null : Math.round(Number(initiative)),
      link: stuffForm.elements.link.value.trim() || null,
    };
    if (stuff) {
      Object.assign(stuff, info);
    } else {
      cls.stuffs.push(Object.assign(info, {
        id: newStuffId(),
        items: window.SLOTS.SLOT_ORDER.map((slot) => ({ slot, variants: [] })),
      }));
    }
    stuffDialog.close();
    scheduleSave();
    render();
  });
  stuffDialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => stuffDialog.close()));
  stuffDialog.addEventListener("click", (e) => { if (e.target === stuffDialog) stuffDialog.close(); });

  // --- Tags (bonus) ----------------------------------------------------------
  const tagDialog = document.getElementById("tag-dialog");
  const tagForm = document.getElementById("tag-form");
  const TAG_HINTS = {
    trans: "ex. Trans 8 Do Crit",
    over: "ex. Over 2 CC",
    exo: "ex. PA, PM, PO",
    removed: "nom de la statistique, sans le −",
  };
  const TAG_KINDS = ["trans", "over", "exo", "removed"];
  const TAG_GROUPS = { trans: "Trans", over: "Over", exo: "Exo", removed: "Statistiques à retirer" };
  const NEW_TAG = "__new";

  // --- Bibliothèque de tags (data/tags.js) -------------------------------------
  const tagLibrary = window.TAGS || [];

  // Identité d'un tag : type + texte, accents / casse / espaces ignorés.
  function tagId(tag) {
    return tag.kind + ":" + normalize(tag.text).replace(/\s+/g, " ").trim();
  }

  function libraryFind(tag) {
    return tagLibrary.find((t) => tagId(t) === tagId(tag));
  }

  function sortLibrary() {
    tagLibrary.sort((a, b) => TAG_KINDS.indexOf(a.kind) - TAG_KINDS.indexOf(b.kind)
      || a.text.localeCompare(b.text, "fr", { numeric: true }));
  }

  function addToLibrary(tag) {
    if (libraryFind(tag)) return;
    tagLibrary.push({ kind: tag.kind, text: tag.text });
    sortLibrary();
    scheduleSave("tags");
  }

  // Parcourt toutes les listes de tags : variantes des stuffs et lots du stock.
  function forEachBonusList(fn) {
    classes.forEach((cls) => cls.stuffs.forEach((s) => s.items.forEach((i) => i.variants.forEach((v) => fn(v, "stuffs")))));
    stock.forEach((lot) => fn(lot, "stock"));
  }

  function tagUsage(tag) {
    let n = 0;
    forEachBonusList((owner) => { n += owner.bonuses.filter((b) => tagId(b) === tagId(tag)).length; });
    return n;
  }

  // Tous les tags utilisés font partie de la bibliothèque.
  function syncTagLibrary() {
    let added = false;
    forEachBonusList((owner) => owner.bonuses.forEach((b) => {
      if (libraryFind(b)) return;
      tagLibrary.push({ kind: b.kind, text: b.text });
      added = true;
    }));
    if (!added) return;
    sortLibrary();
    if (canSave) scheduleSave("tags");
  }

  // Remplace (ou retire, si replacement est null) un tag partout où il est utilisé.
  function replaceTagEverywhere(tag, replacement) {
    const id = tagId(tag);
    forEachBonusList((owner, target) => {
      if (!owner.bonuses.some((b) => tagId(b) === id)) return;
      const next = [];
      owner.bonuses.forEach((b) => {
        const t = tagId(b) === id ? replacement : b;
        if (t && !next.some((x) => tagId(x) === tagId(t))) next.push({ text: t.text, kind: t.kind });
      });
      owner.bonuses = next;
      sortBonuses(owner);
      scheduleSave(target);
    });
  }

  // --- Formulaire de tag ------------------------------------------------------------
  // Choix d'un tag pour un objet : { item, index, onDone } — index = item.bonuses.length pour un ajout ;
  //   item = variante d'un stuff, brouillon d'objet du stock ou de ligne de banque (onDone applique).
  // Édition de la bibliothèque : { library: true, tag } — tag absent pour un ajout.
  let tagTarget = null;

  // Les tags « − » restent après les bonus.
  function sortBonuses(item) {
    item.bonuses.sort((a, b) => (a.kind === "removed") - (b.kind === "removed"));
  }

  function fillTagPicker(selected) {
    const select = tagForm.elements.pick;
    const groups = TAG_KINDS
      .map((kind) => [kind, tagLibrary.filter((t) => t.kind === kind)])
      .filter(([, list]) => list.length)
      .map(([kind, list]) => el("optgroup", { label: TAG_GROUPS[kind] }, list.map((t) => el("option", {
        value: tagId(t),
        text: (kind === "removed" ? "−" : "") + t.text,
      }))));
    select.replaceChildren(
      el("option", { value: "", text: "Choisir un tag…" }),
      ...groups,
      el("option", { value: NEW_TAG, text: "+ Nouveau tag…" }),
    );
    select.value = selected;
  }

  // Champs type + texte : création d'un tag (choix « Nouveau tag… » ou bibliothèque).
  function showNewTagFields(show) {
    document.getElementById("tag-new-fields").hidden = !show;
    tagForm.elements.text.required = show;
    document.getElementById("tag-text-hint").textContent = "(" + TAG_HINTS[tagForm.elements.kind.value] + ")";
  }

  function openTagDialog(title, submitLabel) {
    document.getElementById("tag-dialog-title").textContent = title;
    document.getElementById("tag-form-submit").textContent = submitLabel;
    tagForm.querySelector(".form-error").textContent = "";
    tagDialog.showModal();
  }

  function openTagForm(item, index, onDone) {
    const tag = item.bonuses[index];
    tagTarget = { item, index, onDone };
    const known = tag && libraryFind(tag);
    document.getElementById("tag-pick-field").hidden = false;
    fillTagPicker(known ? tagId(known) : tag ? NEW_TAG : "");
    tagForm.elements.kind.value = tag ? tag.kind : "trans";
    tagForm.elements.text.value = tag && !known ? tag.text : "";
    showNewTagFields(!known && !!tag);
    openTagDialog((tag ? "Modifier le tag" : "Ajouter un tag") + " — " + (item.slot || item.category || item.name), tag ? "Enregistrer" : "Ajouter");
    tagForm.elements.pick.focus();
  }

  function openLibraryTagForm(tag) {
    tagTarget = { library: true, tag };
    document.getElementById("tag-pick-field").hidden = true;
    tagForm.elements.pick.replaceChildren();
    tagForm.elements.kind.value = tag ? tag.kind : "trans";
    tagForm.elements.text.value = tag ? tag.text : "";
    showNewTagFields(true);
    const uses = tag ? tagUsage(tag) : 0;
    openTagDialog(tag ? "Renommer le tag" + (uses ? " (utilisé par " + uses + " objet" + (uses > 1 ? "s" : "") + ")" : "") : "Nouveau tag",
      tag ? "Renommer" : "Ajouter à la bibliothèque");
    tagForm.elements.text.focus();
  }

  // Tag saisi dans les champs type + texte (le − est ajouté à l'affichage : on ne le garde pas).
  function typedTag() {
    const kind = tagForm.elements.kind.value;
    let text = tagForm.elements.text.value.trim();
    if (kind === "removed") text = text.replace(/^[-−]\s*/, "");
    return text ? { kind, text } : null;
  }

  tagForm.elements.pick.addEventListener("change", () => showNewTagFields(tagForm.elements.pick.value === NEW_TAG));
  tagForm.elements.kind.addEventListener("change", () => showNewTagFields(!document.getElementById("tag-new-fields").hidden));
  tagForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const error = tagForm.querySelector(".form-error");

    if (tagTarget.library) {
      const typed = typedTag();
      if (!typed) { error.textContent = "Le texte du tag est vide."; return; }
      const old = tagTarget.tag;
      const existing = libraryFind(typed);
      if (!old) {
        if (existing) { error.textContent = "Ce tag existe déjà dans la bibliothèque."; return; }
        addToLibrary(typed);
      } else {
        // Renommer : le tag change partout ; s'il rejoint un tag existant, les deux fusionnent.
        const target = existing && existing !== old ? existing : typed;
        replaceTagEverywhere(old, target);
        if (target === typed) Object.assign(old, typed);
        else tagLibrary.splice(tagLibrary.indexOf(old), 1);
        sortLibrary();
        scheduleSave("tags");
      }
      tagDialog.close();
      render();
      return;
    }

    const { item, index, onDone } = tagTarget;
    const pick = tagForm.elements.pick.value;
    let tag;
    if (pick === NEW_TAG) {
      const typed = typedTag();
      if (!typed) { error.textContent = "Le texte du tag est vide."; return; }
      // Même tag qu'un existant aux majuscules / accents près : on reprend celui de la bibliothèque.
      tag = libraryFind(typed) || typed;
      addToLibrary(tag);
    } else {
      tag = tagLibrary.find((t) => tagId(t) === pick);
      if (!tag) { error.textContent = "Choisis un tag dans la liste."; return; }
    }
    if (item.bonuses.some((b, i) => i !== index && tagId(b) === tagId(tag))) {
      error.textContent = "Cet objet a déjà ce tag.";
      return;
    }
    item.bonuses[index] = { text: tag.text, kind: tag.kind };
    sortBonuses(item);
    tagDialog.close();
    if (onDone) { onDone(); return; }
    scheduleSave();
    render();
  });
  tagDialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => tagDialog.close()));
  tagDialog.addEventListener("click", (e) => { if (e.target === tagDialog) tagDialog.close(); });

  // --- Stock : ajout / modification d'un lot ---------------------------------
  const stockDialog = document.getElementById("stock-dialog");
  const stockForm = document.getElementById("stock-form");
  const stockItemBtn = document.getElementById("stock-item");
  // { lot (lot modifié, ou null pour un ajout), category, variants, bonuses }
  let stockDraft = null;

  stockForm.elements.category.append(...window.BANK_BUILD.CATEGORIES.map((c) => el("option", { value: c, text: c })));

  function newStockId() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // preset : objet et tags pour préremplir un ajout (bouton « + stock » d'une ligne de la banque).
  // Personnage propriétaire d'un lot (ou null : stock commun).
  function ownerOf(lot) {
    return (lot.owner && classes.find((c) => c.id === lot.owner)) || null;
  }

  function openStockForm(lot, preset) {
    const base = lot || preset || {};
    stockForm.elements.owner.replaceChildren(
      el("option", { value: "", text: "Stock commun (tous les personnages)" }),
      ...classes.map((c) => el("option", { value: c.id, text: c.name + (c.name !== c.class ? " (" + c.class + ")" : "") })),
    );
    stockForm.elements.owner.value = (lot ? lot.owner : preset && preset.owner) || "";
    // Modification : un seul propriétaire ; ajout : plusieurs stocks à la fois (cases à cocher).
    document.getElementById("stock-owner-field").hidden = !lot;
    document.getElementById("stock-targets-field").hidden = !!lot;
    if (!lot) renderStockTargets((preset && preset.owner) || "");
    stockDraft = {
      lot,
      category: base.category || window.BANK_BUILD.CATEGORIES[0],
      variants: (base.variants || []).slice(0, 1).map((v) => ({ name: v.name, itemId: v.itemId })),
      bonuses: (base.bonuses || []).map((b) => ({ text: b.text, kind: b.kind })),
    };
    document.getElementById("stock-dialog-title").textContent = lot ? "Modifier l'objet en stock" : "Ajouter au stock";
    document.getElementById("stock-form-submit").textContent = lot ? "Enregistrer" : "Ajouter au stock";
    stockForm.elements.category.value = stockDraft.category;
    stockForm.elements.quantity.value = lot ? lot.quantity : 1;
    stockForm.elements.status.value = lot ? lot.status : "owned";
    stockForm.querySelector(".form-error").textContent = "";
    renderStockDraft();
    stockDialog.showModal();
  }

  // Cases « Ajouter au stock de » : stock commun + chaque personnage, et un raccourci « Tous les personnages ».
  function renderStockTargets(checked) {
    const box = (value, text, extra) => {
      const input = el("input", { type: "checkbox", name: "target", value });
      input.checked = value === checked;
      return el("label", { class: "target" + (extra ? " " + extra : "") }, [input, el("span", { text })]);
    };
    const all = el("input", { type: "checkbox", class: "target-all" });
    const people = classes.map((c) => box(c.id, c.name, "person"));
    const syncAll = () => {
      const inputs = people.map((p) => p.querySelector("input"));
      all.checked = inputs.length > 0 && inputs.every((i) => i.checked);
      all.indeterminate = !all.checked && inputs.some((i) => i.checked);
    };
    all.addEventListener("change", () => { people.forEach((p) => { p.querySelector("input").checked = all.checked; }); syncAll(); });
    people.forEach((p) => p.querySelector("input").addEventListener("change", syncAll));
    document.getElementById("stock-targets").replaceChildren(
      box("", "Stock commun"),
      classes.length ? el("label", { class: "target target-all-label" }, [all, el("span", { text: "Tous les personnages" })]) : null,
      ...people,
    );
    syncAll();
  }

  function renderStockDraft() {
    const variant = stockDraft.variants[0];
    stockItemBtn.replaceChildren(...(variant
      ? [iconImg(variant), el("span", {}, [variant.name, legendaryStar(isLegendary(variant))])]
      : [el("span", { class: "placeholder", text: "Choisir un objet…" })]));

    const tags = stockDraft.bonuses.map((b, i) => {
      const change = el("button", { type: "button", class: "tag-change", title: "Modifier ce tag" }, [b.kind === "removed" ? "−" : null, b.text]);
      change.addEventListener("click", () => openTagForm(stockDraft, i, renderStockDraft));
      const remove = el("button", { type: "button", class: "tag-remove", title: "Retirer ce tag", "aria-label": "Retirer le tag " + b.text, text: "×" });
      remove.addEventListener("click", () => { stockDraft.bonuses.splice(i, 1); renderStockDraft(); });
      return el("span", { class: "tag tag-editable " + b.kind }, [change, remove]);
    });
    const add = el("button", { type: "button", class: "tag-add", text: "+ tag" });
    add.addEventListener("click", () => openTagForm(stockDraft, stockDraft.bonuses.length, renderStockDraft));
    document.getElementById("stock-tags").replaceChildren(...tags, add);
  }

  stockForm.elements.category.addEventListener("change", () => {
    stockDraft.category = stockForm.elements.category.value;
    // L'objet choisi doit appartenir à la nouvelle catégorie.
    const game = stockDraft.variants[0] && itemsById.get(stockDraft.variants[0].itemId);
    if (game && !typesForCategory(stockDraft.category).includes(game.typeId)) stockDraft.variants = [];
    renderStockDraft();
  });

  stockItemBtn.addEventListener("click", () => {
    const current = stockDraft.variants[0];
    openItemPicker(stockDraft.category + " — stock", {
      types: typesForCategory(stockDraft.category),
      selectedId: current && current.itemId,
      stockCategory: null,
      onChoose: (gameItem) => {
        stockDraft.variants = [{ name: gameItem.name, itemId: gameItem.id }];
        renderStockDraft();
      },
    });
  });

  stockForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const error = stockForm.querySelector(".form-error");
    const quantity = Number(stockForm.elements.quantity.value);
    if (!stockDraft.variants.length) { error.textContent = "Choisis un objet."; return; }
    if (!Number.isInteger(quantity) || quantity < 1) { error.textContent = "La quantité doit être un nombre entier positif."; return; }

    sortBonuses(stockDraft);
    const data = {
      category: stockDraft.category,
      variants: stockDraft.variants,
      bonuses: stockDraft.bonuses,
      quantity,
      status: stockForm.elements.status.value,
    };
    const key = window.BANK_BUILD.keyOf(data.variants, data.bonuses);

    if (stockDraft.lot) {
      const owner = stockForm.elements.owner.value || null;
      Object.assign(stockDraft.lot, data);
      if (owner) stockDraft.lot.owner = owner;
      else delete stockDraft.lot.owner;
    } else {
      // Un exemplaire dans chaque stock coché ("" = stock commun).
      const targets = [...stockForm.querySelectorAll('input[name="target"]:checked')].map((i) => i.value || null);
      if (!targets.length) { error.textContent = "Coche au moins un stock."; return; }
      targets.forEach((owner) => {
        // Un ajout identique (objet, tags, état, propriétaire) à un lot existant augmente sa quantité.
        const same = stock.find((l) => l.status === data.status && (l.owner || null) === owner
          && window.BANK_BUILD.keyOf(l.variants, l.bonuses) === key);
        if (same) same.quantity += quantity;
        else stock.push(Object.assign({ id: newStockId() }, data, owner ? { owner } : {}, { variants: data.variants.map((v) => ({ ...v })), bonuses: copyBonuses(data.bonuses) }));
      });
    }

    stockDialog.close();
    scheduleSave("stock");
    render();
  });
  stockDialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => stockDialog.close()));
  stockDialog.addEventListener("click", (e) => { if (e.target === stockDialog) stockDialog.close(); });

  // --- Rendu -----------------------------------------------------------------
  function tagEl(bonus, query) {
    return el("span", { class: "tag " + bonus.kind, title: KIND_LABEL[bonus.kind] }, [
      bonus.kind === "removed" ? "−" : null,
      highlight(bonus.text, query),
    ]);
  }

  function renderNav(query) {
    nav.replaceChildren(...classes.map((cls) => {
      const hasMatch = cls.stuffs.some((s) => s.items.some((i) => matches(i, query)));
      const btn = el("button", {
        class: "class-btn" + (hasMatch ? "" : " dim"),
        type: "button",
        "aria-pressed": String(cls.name === current),
      }, [
        el("img", { src: classIcon(cls.class), alt: "" }),
        el("span", { text: cls.name }),
        el("span", { class: "count", text: cls.stuffs.length + (cls.stuffs.length > 1 ? " stuffs" : " stuff") }),
      ]);
      btn.title = cls.class;
      btn.addEventListener("click", () => { current = cls.name; location.hash = encodeURIComponent(cls.name); render(); });
      return btn;
    }));
    if (editing) {
      const add = el("button", { type: "button", class: "class-btn class-add", text: "+ Personnage" });
      add.addEventListener("click", () => openCharacterForm(null));
      nav.append(add);
    }
  }

  // À obtenir -> Fabriqué -> Possédé -> À obtenir (Maj+clic dans l'autre sens).
  // blockEl : bloc de l'objet (ligne + tags), coloré selon l'état.
  function statusToggle(cls, stuff, item, index, blockEl) {
    const toggle = el("button", { type: "button", class: "status-toggle" });
    const show = (status) => {
      blockEl.dataset.status = status;
      toggle.dataset.status = status;
      toggle.title = STATUS_LABEL[status] + "\nClic : état suivant · Maj+clic : état précédent";
      toggle.setAttribute("aria-label", item.variants[index].name + " : " + STATUS_LABEL[status]);
    };
    show(variantStatusOf(cls, stuff, item, index));
    toggle.addEventListener("click", (e) => {
      const step = e.shiftKey ? -1 : 1;
      const next = STATUSES[(STATUSES.indexOf(variantStatusOf(cls, stuff, item, index)) + step + STATUSES.length) % STATUSES.length];
      setVariantStatus(cls, stuff, item, index, next);
      show(next);
      updateProgress(blockEl.closest(".stuff"), cls, stuff);
      // Boutons ⚒ : celui-ci, et ceux des autres stuffs liés au même exemplaire (retiré s'il est fabriqué).
      document.querySelectorAll(".craft-toggle").forEach((b) => { if (b.update) b.update(); });
    });
    return toggle;
  }

  function renderVariant(cls, stuff, item, index, query, blockEl) {
    const variant = item.variants[index];
    const name = el("span", { class: "name" }, [highlight(variant.name, query)]);
    const star = legendaryStar(isLegendary(variant));
    if (star) name.append(star);
    const variantEl = el("div", { class: "variant" });
    variantEl.append(statusToggle(cls, stuff, item, index, blockEl));
    const tags = variant.bonuses.length || editing ? renderVariantTags(variant, query) : null;
    const craftBtn = craftToggle(cls, stuff, item, index);
    if (!editing) {
      variantEl.append(iconImg(variant), name);
      if (tags) variantEl.append(tags);
      variantEl.append(craftBtn);
      return variantEl;
    }

    const change = el("button", { type: "button", class: "variant-change", title: "Changer d'objet" }, [iconImg(variant), name]);
    change.addEventListener("click", () => openPicker(stuff, item, index));
    const remove = el("button", { type: "button", class: "variant-remove", title: "Retirer cet objet", "aria-label": "Retirer " + variant.name, text: "×" });
    remove.addEventListener("click", () => {
      returnToStock(item, index);
      item.variants.splice(index, 1);
      scheduleSave();
      render();
    });
    variantEl.append(change);
    if (tags) variantEl.append(tags);
    variantEl.append(craftBtn, remove);
    return variantEl;
  }

  // Tags (forgemagie) d'une variante, modifiables en mode édition.
  function renderVariantTags(variant, query) {
    const tags = variant.bonuses.map((b, i) => {
      if (!editing) return tagEl(b, query);

      const label = [b.kind === "removed" ? "−" : null, highlight(b.text, query)];
      const change = el("button", { type: "button", class: "tag-change", title: "Modifier ce tag (" + KIND_LABEL[b.kind] + ")" }, label);
      change.addEventListener("click", () => openTagForm(variant, i));
      const remove = el("button", { type: "button", class: "tag-remove", title: "Retirer ce tag", "aria-label": "Retirer le tag " + b.text, text: "×" });
      remove.addEventListener("click", () => {
        variant.bonuses.splice(i, 1);
        scheduleSave();
        render();
      });
      return el("span", { class: "tag tag-editable " + b.kind }, [change, remove]);
    });
    if (editing) {
      const add = el("button", { type: "button", class: "tag-add", text: "+ tag" });
      add.addEventListener("click", () => openTagForm(variant, variant.bonuses.length));
      tags.push(add);
    }
    return el("div", { class: "bonuses" }, tags);
  }

  function renderItem(cls, stuff, item, query) {
    const body = el("div", { class: "body" });
    item.variants.forEach((variant, i) => {
      if (i > 0) body.append(el("span", { class: "or", text: "ou" }));
      const block = el("div", { class: "variant-block" });
      block.append(renderVariant(cls, stuff, item, i, query, block));
      body.append(block);
    });
    if (!item.variants.length && !editing) body.append(el("span", { class: "vacant", text: "Aucun objet" }));
    if (editing) {
      const add = el("button", {
        type: "button",
        class: "variant-add",
        text: item.variants.length ? "+ variante" : "+ Ajouter un objet",
      });
      add.addEventListener("click", () => openPicker(stuff, item, item.variants.length));
      body.append(add);
    }
    return el("li", { class: "item" }, [
      el("span", { class: "slot" }, [highlight(item.slot, query)]),
      body,
    ]);
  }

  function updateProgress(card, cls, stuff) {
    const total = stuff.items.length;
    const count = (status) => stuff.items.filter((i) => i.variants.length && slotStatusOf(cls, stuff, i) === status).length;
    const owned = count("owned");
    const crafted = count("crafted");
    card.querySelector(".progress .owned").style.width = (100 * owned / total) + "%";
    card.querySelector(".progress .crafted").style.width = (100 * crafted / total) + "%";
    card.querySelector(".done-count").textContent = owned + " / " + total + " possédés"
      + (crafted ? " · " + crafted + (crafted > 1 ? " fabriqués" : " fabriqué") : "");
  }

  // Exos qui ne se cumulent pas : un seul par stuff. PO est affiché « Portée ».
  const UNIQUE_EXOS = { pa: "PA", pm: "PM", po: "Portée" };

  // Exos PA / PM / PO présents plusieurs fois dans un stuff : [{ label, slots: [emplacements] }].
  // Un emplacement compte une seule fois, même si plusieurs de ses variantes ont le tag (une seule est portée).
  function duplicateExos(stuff) {
    const slotsByExo = {};
    stuff.items.forEach((item) => {
      const exos = new Set();
      item.variants.forEach((v) => v.bonuses.forEach((b) => {
        const key = normalize(b.text).trim();
        if (b.kind === "exo" && UNIQUE_EXOS[key]) exos.add(key);
      }));
      exos.forEach((key) => { (slotsByExo[key] = slotsByExo[key] || []).push(item.slot); });
    });
    return Object.keys(UNIQUE_EXOS)
      .filter((key) => (slotsByExo[key] || []).length > 1)
      .map((key) => ({ label: UNIQUE_EXOS[key], slots: slotsByExo[key] }));
  }

  function renderExoWarning(stuff) {
    const duplicates = duplicateExos(stuff);
    if (!duplicates.length) return null;
    const labels = duplicates.map((d) => d.label);
    const text = "Plus d'un Exo " + (labels.length > 1 ? labels.slice(0, -1).join(", ") + " et " + labels[labels.length - 1] : labels[0]);
    const title = duplicates.map((d) => "Exo " + d.label + " sur : " + d.slots.join(", ")).join("\n");
    return el("span", { class: "exo-warning", role: "status", title }, [el("span", { "aria-hidden": "true", text: "⚠ " }), text]);
  }

  function renderStuff(cls, stuff, query) {
    const visible = stuff.items.filter((i) => matches(i, query));
    if (!visible.length) return null;

    const meta = el("div", { class: "meta" }, [
      stuff.initiative != null && el("span", { text: "Initiative " + stuff.initiative }),
      el("span", { class: "done-count" }),
      stuff.link && el("a", { href: stuff.link, target: "_blank", rel: "noopener", text: "DofusBook ↗" }),
    ]);

    const title = el("div", { class: "stuff-title" }, [el("h3", {}, [
      stuff.name,
      (() => {
        const lvl = stuffLevel(stuff);
        if (!lvl) return null;
        return el("span", {
          class: "stuff-level" + (lvl.derived ? " derived" : ""),
          title: lvl.derived ? "Niveau déduit de l'objet le plus haut niveau (aucun niveau saisi)" : "Niveau du stuff",
          text: "Niv. " + lvl.level,
        });
      })(),
    ])]);
    // En haut à droite : avertissement d'exos en double, puis (en édition) les boutons.
    const right = el("div", { class: "stuff-title-right" }, [renderExoWarning(stuff)]);
    title.append(right);
    if (editing) {
      const edit = el("button", { type: "button", class: "btn btn-small", text: "Modifier les infos" });
      edit.addEventListener("click", () => openStuffForm(cls, stuff));
      const remove = el("button", { type: "button", class: "btn btn-small btn-danger", text: "Supprimer" });
      remove.addEventListener("click", () => {
        if (!confirm("Supprimer le stuff « " + stuffLabel(stuff) + " » de " + cls.name + " ?\nCette action est définitive.")) return;
        cls.stuffs.splice(cls.stuffs.indexOf(stuff), 1);
        scheduleSave();
        render();
      });
      right.append(el("div", { class: "stuff-actions" }, [edit, remove]));
    }

    const card = el("article", { class: "stuff" }, [
      el("div", { class: "stuff-head" }, [
        title,
        meta,
        el("div", { class: "progress" }, [el("span", { class: "owned" }), el("span", { class: "crafted" })]),
      ]),
    ]);

    const groups = new Map();
    visible.forEach((item) => {
      const g = groupOf(item);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(item);
    });
    // Équipements dans une colonne, Familier + Dofus dans l'autre.
    const columns = { main: el("div", { class: "column" }), side: el("div", { class: "column" }) };
    groups.forEach((items, title) => {
      columns[title === "Équipements" ? "main" : "side"].append(
        el("h4", { class: "group-title", text: title }),
        el("ul", { class: "items" }, items.map((i) => renderItem(cls, stuff, i, query))),
      );
    });
    card.append(el("div", { class: "columns" }, [columns.main, columns.side].filter((c) => c.childElementCount)));

    updateProgress(card, cls, stuff);
    return card;
  }

  // --- Banque d'objets -------------------------------------------------------
  const BANK_STATUS = { all: "Tous", missing: "À obtenir", crafted: "Fabriqués (à modifier)", owned: "Possédés", stock: "En stock" };
  // data/bank.js : export de la banque, resynchronisé à chaque enregistrement des stuffs.
  const exportedBank = window.BANK || null;
  if (exportedBank) window.BANK_BUILD.normalizeEntries(exportedBank.entries);
  let bankCategory = null;
  let bankStatus = "all";
  // Filtre par tag : "" = tous, NO_TAG = objets sans tag, sinon identifiant de tag (tagId).
  let bankTag = "";
  const NO_TAG = "__none";

  function liveBank() {
    return window.BANK_BUILD.buildBank(classes, { itemsById, iconLinks: icons });
  }

  // Lignes de la banque : objets attribués (export) + lots du stock, regroupés par objet + tags.
  function bankRows(entries) {
    const rows = entries.map((e) => Object.assign({}, e, { lots: [] }));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    stock.forEach((lot) => {
      const key = window.BANK_BUILD.keyOf(lot.variants, lot.bonuses);
      if (!byKey.has(key)) {
        const row = { key, category: lot.category, variants: lot.variants, bonuses: lot.bonuses, holders: [], quantity: 0, owned: 0, crafted: 0, lots: [] };
        byKey.set(key, row);
        rows.push(row);
      }
      byKey.get(key).lots.push(lot);
    });
    return rows.sort(window.BANK_BUILD.compareEntries);
  }

  // ignore : { category, tag } — filtres non appliqués (compteurs des pastilles et de la liste des tags).
  function bankMatches(row, query, ignore = {}) {
    if (!ignore.category && bankCategory && row.category !== bankCategory) return false;
    if (bankStatus === "stock" && !row.lots.length) return false;
    // Au moins un personnage ou un lot du stock dans l'état filtré.
    if (STATUSES.includes(bankStatus) && !row.holders.some((h) => h.status === bankStatus) && !row.lots.some((l) => l.status === bankStatus)) return false;
    if (!ignore.tag && bankTag === NO_TAG && row.bonuses.length) return false;
    if (!ignore.tag && bankTag && bankTag !== NO_TAG && !row.bonuses.some((b) => tagId(b) === bankTag)) return false;
    if (!query) return true;
    const words = [row.category, ...row.variants.map((v) => v.name), ...row.bonuses.map((b) => b.text), ...row.holders.map((h) => h.class)];
    return normalize(words.join(" ")).includes(query);
  }

  // withOwner : ajoute « — <personnage> » pour un lot réservé (banque).
  function renderLot(lot, withOwner = true) {
    const owner = ownerOf(lot);
    const label = el("span", { text: stockLabel(lot) + (withOwner && owner ? " — " + owner.name : "") });
    const title = owner ? "En stock, réservé à " + owner.name : "Objet en stock, pas encore attribué";
    if (!editing) return el("span", { class: "stock-lot", "data-status": lot.status, title }, [label]);

    const change = el("button", { type: "button", class: "tag-change", title: "Modifier ce lot (quantité, état, tags)" }, ["✎ ", label]);
    change.addEventListener("click", () => openStockForm(lot));
    const remove = el("button", { type: "button", class: "tag-remove", title: "Retirer ce lot du stock", "aria-label": "Retirer du stock", text: "×" });
    remove.addEventListener("click", () => {
      if (!confirm("Retirer " + lot.quantity + " × « " + lot.variants[0].name + " » du stock ?")) return;
      stock.splice(stock.indexOf(lot), 1);
      scheduleSave("stock");
      render();
    });
    return el("span", { class: "stock-lot tag-editable", "data-status": lot.status }, [change, remove]);
  }

  // Objets des stuffs (variantes) correspondant à une ligne de la banque (même objet + mêmes tags).
  function rowSlots(row) {
    const slots = [];
    classes.forEach((cls) => cls.stuffs.forEach((stuff) => stuff.items.forEach((item) => item.variants.forEach((v) => {
      const id = gameIdOf(v);
      const game = id && itemsById.get(id);
      if (window.BANK_BUILD.keyOf([{ name: game ? game.name : v.name, itemId: id || null }], v.bonuses) === row.key) slots.push(v);
    }))));
    return slots;
  }

  // Les tags d'une ligne s'appliquent à tous ses exemplaires : emplacements de stuffs et lots du stock.
  function applyRowBonuses(row, bonuses) {
    const copy = () => bonuses.map((b) => ({ text: b.text, kind: b.kind }));
    const slots = rowSlots(row);
    slots.forEach((variant) => { variant.bonuses = copy(); });
    row.lots.forEach((lot) => { lot.bonuses = copy(); });
    if (slots.length) scheduleSave("stuffs");
    if (row.lots.length) scheduleSave("stock");
    render();
  }

  function renderRowTags(row, query) {
    if (!editing) return row.bonuses.map((b) => tagEl(b, query));
    const slotCount = rowSlots(row).length;
    const lotCount = row.lots.reduce((n, l) => n + l.quantity, 0);
    const scope = [slotCount && slotCount + (slotCount > 1 ? " emplacements" : " emplacement"), lotCount && lotCount + " en stock"]
      .filter(Boolean).join(" + ");
    // Brouillon pour le formulaire de tag : les modifications sont appliquées à la validation.
    const draft = () => ({ slot: row.variants[0].name + (scope ? " (" + scope + ")" : ""), bonuses: row.bonuses.map((b) => ({ text: b.text, kind: b.kind })) });

    const tags = row.bonuses.map((b, i) => {
      const change = el("button", { type: "button", class: "tag-change", title: "Modifier ce tag pour : " + scope }, [b.kind === "removed" ? "−" : null, highlight(b.text, query)]);
      change.addEventListener("click", () => { const d = draft(); openTagForm(d, i, () => applyRowBonuses(row, d.bonuses)); });
      const remove = el("button", { type: "button", class: "tag-remove", title: "Retirer ce tag pour : " + scope, "aria-label": "Retirer le tag " + b.text, text: "×" });
      remove.addEventListener("click", () => applyRowBonuses(row, row.bonuses.filter((_, j) => j !== i)));
      return el("span", { class: "tag tag-editable " + b.kind }, [change, remove]);
    });
    const add = el("button", { type: "button", class: "tag-add", text: "+ tag" });
    add.addEventListener("click", () => { const d = draft(); openTagForm(d, d.bonuses.length, () => applyRowBonuses(row, d.bonuses)); });
    tags.push(add);
    return tags;
  }

  // État d'une case pour le tri : équipé, fabriqué, non possédé, puis stock seulement.
  // Plusieurs personnages : l'état le moins avancé (il reste quelque chose à faire).
  const BANK_STATE_ORDER = ["equipped", "crafted", "missing", "stock"];

  function bankRowState(row) {
    if (!row.holders.length) return "stock";
    if (row.holders.some((h) => h.status === "missing")) return "missing";
    if (row.holders.some((h) => h.status === "crafted")) return "crafted";
    return "equipped";
  }

  // Case d'un objet de la banque, de haut en bas : nom, tags, personnages, quantités.
  function renderBankEntry(row, query) {
    const names = el("div", { class: "bank-names" });
    row.variants.forEach((variant, i) => {
      if (i > 0) names.append(el("span", { class: "or", text: "ou" }));
      names.append(el("div", { class: "variant" }, [iconImg(variant), el("span", { class: "name" }, [highlight(variant.name, query), legendaryStar(isLegendary(variant))])]));
    });

    const holders = row.holders.length
      ? el("div", { class: "bank-holders" }, row.holders.map((h) => {
        const title = h.class + " — " + STATUS_LABEL[h.status].toLowerCase() + "\nStuffs : " + h.stuffs.join(", ");
        return el("span", { class: "holder", "data-status": h.status, title }, [
          el("img", { src: classIcon(h.classType || h.class), alt: h.class }),
        ]);
      }))
      : null;

    // Quantités : personnages qui l'utilisent, équipés, fabriqués, puis exemplaires en stock.
    const inStock = row.lots.reduce((n, l) => n + l.quantity, 0);
    const stockTitle = row.lots.map((l) => {
      const owner = ownerOf(l);
      return stockLabel(l) + " — " + (owner ? owner.name : "stock commun");
    }).join("\n");
    const counts = el("div", { class: "bank-count" }, [
      row.quantity
        ? el("span", { class: "bank-qty", title: "Nombre de personnages qui l'utilisent", text: "×" + row.quantity })
        : el("span", { class: "bank-unassigned", text: "Non attribué" }),
      row.quantity ? el("span", { class: "bank-owned", text: row.owned + " / " + row.quantity + (row.owned > 1 ? " équipés" : " équipé") }) : null,
      row.crafted ? el("span", { class: "bank-crafted", text: row.crafted + (row.crafted > 1 ? " fabriqués" : " fabriqué") }) : null,
      inStock ? el("span", { class: "bank-stock", title: stockTitle, text: inStock + " en stock" }) : null,
      // Stocks qui contiennent l'objet : personnages (icône carrée) et stock commun.
      row.lots.length ? el("div", { class: "bank-stock-owners" }, row.lots.map((lot) => {
        const owner = ownerOf(lot);
        const title = (owner ? owner.name : "Stock commun") + " — " + stockLabel(lot);
        return el("span", { class: "stock-owner", "data-status": lot.status, title }, [
          owner ? el("img", { src: classIcon(owner.class), alt: owner.name }) : el("span", { class: "stock-owner-common", text: "Commun" }),
          lot.quantity > 1 ? el("span", { class: "stock-owner-qty", text: "×" + lot.quantity }) : null,
        ]);
      })) : null,
    ]);

    // Édition : lots du stock (modifier / retirer) et ajout.
    let stockLine = null;
    if (editing) {
      stockLine = el("div", { class: "stock-lots" }, row.lots.map((lot) => renderLot(lot)));
      const add = el("button", { type: "button", class: "tag-add", text: "+ stock" });
      add.addEventListener("click", () => openStockForm(null, row));
      stockLine.append(add);
    }

    const complete = row.quantity > 0 && row.owned >= row.quantity;
    return el("li", { class: "bank-entry" + (complete ? " done" : ""), "data-state": bankRowState(row) }, [
      names,
      (row.bonuses.length || editing) ? el("div", { class: "bonuses" }, renderRowTags(row, query)) : null,
      holders,
      counts,
      stockLine,
    ]);
  }

  function renderBank(query) {
    nav.replaceChildren();
    const entries = liveBank();
    const rows = bankRows(entries);
    const total = entries.reduce((n, e) => n + e.quantity, 0);
    const owned = entries.reduce((n, e) => n + e.owned, 0);
    const crafted = entries.reduce((n, e) => n + e.crafted, 0);
    const inStock = stock.reduce((n, l) => n + l.quantity, 0);

    const categories = window.BANK_BUILD.CATEGORIES.filter((c) => rows.some((r) => r.category === c));
    const chip = (label, value, count) => {
      const b = el("button", { type: "button", class: "chip" + (count ? "" : " empty-chip"), "aria-pressed": String(bankCategory === value) }, [
        el("span", { text: label }), el("span", { class: "count", text: String(count) }),
      ]);
      b.addEventListener("click", () => { bankCategory = value; render(); });
      return b;
    };
    const statusSelect = el("select", { class: "bank-status", "aria-label": "Filtrer par état" },
      Object.entries(BANK_STATUS).map(([value, label]) => el("option", { value, text: label })));
    statusSelect.value = bankStatus;
    statusSelect.addEventListener("change", () => { bankStatus = statusSelect.value; render(); });

    // Tags présents dans la banque, groupés par type. Compteur : objets visibles avec ce tag,
    // selon les autres filtres (catégorie, état, recherche) mais pas le tag choisi.
    const tagCounts = new Map();
    rows.forEach((r) => r.bonuses.forEach((b) => {
      if (!tagCounts.has(tagId(b))) tagCounts.set(tagId(b), { tag: libraryFind(b) || b, count: 0 });
    }));
    const tagScope = rows.filter((r) => bankMatches(r, query, { tag: true }));
    tagScope.forEach((r) => r.bonuses.forEach((b) => { tagCounts.get(tagId(b)).count += 1; }));
    const untagged = tagScope.filter((r) => !r.bonuses.length).length;
    const tagSelect = el("select", { class: "bank-status", "aria-label": "Filtrer par tag" }, [
      el("option", { value: "", text: "Tous les tags" }),
      ...TAG_KINDS.map((kind) => {
        const list = [...tagCounts].filter(([, t]) => t.tag.kind === kind)
          .sort(([, a], [, b]) => a.tag.text.localeCompare(b.tag.text, "fr", { numeric: true }));
        return list.length && el("optgroup", { label: TAG_GROUPS[kind] }, list.map(([id, t]) => el("option", {
          value: id,
          text: (kind === "removed" ? "−" : "") + t.tag.text + " (" + t.count + ")",
        })));
      }),
      el("option", { value: NO_TAG, text: "Sans tag (" + untagged + ")" }),
    ]);
    // Un tag qui n'existe plus dans la banque (renommé, retiré) : retour à « Tous les tags ».
    if (bankTag && bankTag !== NO_TAG && !tagCounts.has(bankTag)) bankTag = "";
    tagSelect.value = bankTag;
    tagSelect.addEventListener("change", () => { bankTag = tagSelect.value; render(); });

    const tools = [tagSelect, statusSelect];
    if (editing) {
      const add = el("button", { type: "button", class: "btn btn-primary btn-small", text: "+ Ajouter au stock" });
      add.addEventListener("click", () => openStockForm(null, bankCategory ? { category: bankCategory } : null));
      tools.unshift(add);
    }

    // Compteurs des pastilles : tous les filtres sauf la catégorie.
    const filtered = rows.filter((r) => bankMatches(r, query, { category: true }));
    const visible = filtered.filter((r) => !bankCategory || r.category === bankCategory);
    const groups = categories
      .map((c) => [c, visible.filter((r) => r.category === c)])
      .filter(([, list]) => list.length)
      .map(([c, list]) => el("section", { class: "bank-group" }, [
        el("h3", { class: "group-title", text: c + " · " + list.length }),
        // Tri stable : par état, l'ordre alphabétique est gardé à état égal.
        el("ul", { class: "bank-list" }, [...list]
          .sort((a, b) => BANK_STATE_ORDER.indexOf(bankRowState(a)) - BANK_STATE_ORDER.indexOf(bankRowState(b)))
          .map((r) => renderBankEntry(r, query))),
      ]));

    content.replaceChildren(...[
      el("div", { class: "class-head" }, [
        el("div", {}, [
          el("h2", { text: "Banque d'objets" }),
          el("p", { text: total + " objets attribués · " + rows.length + " différents · " + owned + " équipés · "
            + crafted + (crafted > 1 ? " fabriqués" : " fabriqué") + " · " + inStock + " en stock" }),
        ]),
      ]),
      classes.length ? renderScrollShopping() : null,
      classes.length ? renderSpellsToUnlock() : null,
      el("div", { class: "bank-filters" }, [
        el("div", { class: "chips" }, [chip("Tous", null, filtered.length), ...categories.map((c) => chip(c, c, filtered.filter((r) => r.category === c).length))]),
        el("div", { class: "bank-tools" }, tools),
      ]),
      groups.length
        ? el("div", { class: "stuff bank" }, groups)
        : el("p", { class: "empty", text: "Aucun objet ne correspond aux filtres." }),
    ].filter(Boolean));
  }

  // --- Bibliothèque de tags : vue ------------------------------------------------
  function renderTagLibrary(query) {
    nav.replaceChildren();
    const visible = tagLibrary.filter((t) => !query || normalize(t.text).includes(query));
    const groups = TAG_KINDS
      .map((kind) => [kind, visible.filter((t) => t.kind === kind)])
      .filter(([, list]) => list.length)
      .map(([kind, list]) => el("section", { class: "bank-group" }, [
        el("h3", { class: "group-title", text: TAG_GROUPS[kind] + " · " + list.length }),
        el("ul", { class: "tag-list" }, list.map((tag) => {
          const uses = tagUsage(tag);
          const label = [tag.kind === "removed" ? "−" : null, highlight(tag.text, query)];
          let chip = tagEl(tag, query);
          if (editing) {
            const change = el("button", { type: "button", class: "tag-change", title: "Renommer ce tag (partout où il est utilisé)" }, label);
            change.addEventListener("click", () => openLibraryTagForm(tag));
            const remove = el("button", { type: "button", class: "tag-remove", title: "Supprimer ce tag", "aria-label": "Supprimer le tag " + tag.text, text: "×" });
            remove.addEventListener("click", () => {
              const message = "Supprimer le tag « " + tag.text + " » de la bibliothèque ?"
                + (uses ? "\nIl sera retiré de " + uses + " objet" + (uses > 1 ? "s" : "") + "." : "");
              if (!confirm(message)) return;
              replaceTagEverywhere(tag, null);
              tagLibrary.splice(tagLibrary.indexOf(tag), 1);
              scheduleSave("tags");
              render();
            });
            chip = el("span", { class: "tag tag-editable " + tag.kind }, [change, remove]);
          }
          return el("li", { class: "tag-row" }, [
            chip,
            el("span", { class: "tag-uses", text: uses ? "utilisé par " + uses + " objet" + (uses > 1 ? "s" : "") : "inutilisé" }),
          ]);
        })),
      ]));

    const head = el("div", { class: "bank-filters" }, [
      el("div", {}, [
        el("h2", { text: "Bibliothèque de tags" }),
        el("p", { class: "tag-summary", text: tagLibrary.length + " tags · proposés à l'ajout d'un tag sur un objet" }),
      ]),
    ]);
    if (editing) {
      const add = el("button", { type: "button", class: "btn btn-primary btn-small", text: "+ Nouveau tag" });
      add.addEventListener("click", () => openLibraryTagForm(null));
      head.append(add);
    }
    content.replaceChildren(head, groups.length
      ? el("div", { class: "stuff bank" }, groups)
      : el("p", { class: "empty", text: "Aucun tag ne correspond à la recherche." }));
  }

  // --- Historique des modifications ----------------------------------------------
  let historyEntries = null; // chargé depuis le serveur à l'ouverture de l'onglet
  let historyError = null;

  async function loadHistory() {
    try {
      const res = await fetch("api/history" + (folderQuery ? folderQuery + "&" : "?") + "log=" + historyLog(), { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "HTTP " + res.status);
      historyEntries = data.entries;
      historyError = null;
    } catch (err) {
      historyError = err.message;
    }
    if (currentView() === "history") render();
  }

  async function undoHistory(entry, laterCount) {
    const later = laterCount === 1 ? " et la suivante" : laterCount > 1 ? " et les " + laterCount + " suivantes" : "";
    const message = "Annuler cette modification" + later + " ?"
      + "\nLes stuffs, le stock, les tags et la fabrication reviendront à leur état d'avant.";
    if (!confirm(message)) return;
    setStatus("Annulation…", "pending");
    try {
      await flushSaves();
      const res = await fetch("api/history/undo" + folderQuery, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, log: historyLog() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "HTTP " + res.status);
      // Les données en mémoire ne sont plus à jour : on recharge depuis les fichiers
      // (sans l'avertissement « modifications en attente » de la page).
      setStatus("Annulé", "ok");
      location.reload();
    } catch (err) {
      setStatus("Erreur d'annulation : " + err.message, "error");
    }
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function renderHistory(query) {
    nav.replaceChildren();
    const head = el("div", {}, [
      el("h2", { text: "Historique des modifications" }),
      el("nav", { class: "history-tabs", "aria-label": "Historiques" }, [
        el("a", { class: "chip", href: "#historique", "aria-current": String(historyLog() === "general"), text: "Général" }),
        el("a", { class: "chip", href: "#historique-fabrication", "aria-current": String(historyLog() === "fabrication"), text: "Fabrication" }),
      ]),
      el("p", { class: "tag-summary", text: "Annuler une modification annule aussi toutes celles qui ont suivi." }),
    ]);
    if (!canSave) {
      content.replaceChildren(head, el("p", { class: "empty", text: "L'historique est tenu par le serveur : lancer « npm start »." }));
      return;
    }
    if (!historyEntries) {
      content.replaceChildren(head, el("p", { class: "empty", text: historyError ? "Erreur : " + historyError : "Chargement…" }));
      if (!historyError) loadHistory();
      return;
    }

    const matchesEntry = (e) => !query || normalize(e.changes.map((c) => c.scope + " " + c.text).join(" ")).includes(query);
    const items = historyEntries.map((entry, i) => {
      if (!matchesEntry(entry)) return null;
      // Changements regroupés par élément concerné.
      const groups = new Map();
      entry.changes.forEach((c) => {
        if (!groups.has(c.scope)) groups.set(c.scope, []);
        groups.get(c.scope).push(c.text);
      });
      const undo = el("button", { type: "button", class: "btn btn-small", text: "Annuler" });
      undo.addEventListener("click", () => undoHistory(entry, i));
      return el("li", { class: "history-entry" }, [
        el("div", { class: "history-head" }, [el("time", { datetime: entry.at, text: formatDate(entry.at) }), undo]),
        ...[...groups].map(([scope, texts]) => el("div", { class: "history-group" }, [
          el("div", { class: "history-scope" }, [highlight(scope, query)]),
          el("ul", { class: "history-changes" }, texts.map((t) => el("li", {}, [highlight(t, query)]))),
        ])),
      ]);
    }).filter(Boolean);

    content.replaceChildren(head, items.length
      ? el("ol", { class: "stuff history-list" }, items)
      : el("p", { class: "empty", text: historyEntries.length ? "Aucune modification ne correspond à la recherche." : "Aucune modification enregistrée pour l'instant." }));
  }

  // --- Fabrication ---------------------------------------------------------------
  // Liste du dossier : un exemplaire par objet à fabriquer, lié à des stuffs (même personnage) ou destiné à un stock.
  //   copy : { id, itemId, seq (ordre d'ajout), owner (id du personnage ou null), links: [{ cls, stuff, slot }] }
  // Un seul compteur par ressource (counters), réparti entre les objets dans leur ordre d'ajout.
  const recipesData = window.DOFUS_RECIPES || { jobs: {}, ingredients: {}, recipes: {} };
  const craft = Object.assign({ copies: [], counters: {}, seq: 0 }, window.CRAFT || {});
  const CRAFT_LOG = { log: "fabrication" };
  const CRAFT_SORTS = { job: "Métier puis type d'objet", character: "Personnage puis stuff" };
  const CRAFT_SORT_KEY = "tracking-stuff:craft-sort";
  const CRAFT_HIDE_KEY = "tracking-stuff:craft-hide-done";

  function recipeOf(itemId) {
    return recipesData.recipes[itemId] || null;
  }

  function newCopyId() {
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function itemName(itemId) {
    const game = itemsById.get(itemId);
    return game ? game.name : "Objet " + itemId;
  }

  function itemIcon(itemId) {
    const game = itemsById.get(itemId);
    const img = el("img", { class: "icon", alt: "", loading: "lazy", src: game ? "assets/items/" + game.iconId + ".png" : "" });
    if (game) img.addEventListener("error", () => { img.src = DOFUSDB_IMG_URL + game.iconId + ".png"; }, { once: true });
    return img;
  }

  // Catégorie de la banque (Anneau, Cape…) d'un type d'objet DofusDB.
  function categoryOfType(typeId) {
    return window.BANK_BUILD.CATEGORIES.find((c) => typesForCategory(c).includes(typeId)) || window.BANK_BUILD.CATEGORIES[0];
  }

  // Lien d'un exemplaire vers une variante d'un stuff ; error si le personnage, le stuff ou l'objet n'y est plus.
  function resolveLink(link, itemId) {
    const cls = classes.find((c) => c.id === link.cls);
    if (!cls) return { error: "Personnage supprimé" };
    const stuff = cls.stuffs.find((s) => s.id === link.stuff);
    if (!stuff) return { cls, error: "Stuff supprimé" };
    const item = stuff.items.find((i) => i.slot === link.slot);
    const index = item ? item.variants.findIndex((v) => gameIdOf(v) === itemId) : -1;
    if (index < 0) return { cls, stuff, error: "Retiré de " + stuff.name };
    return { cls, stuff, item, index, variant: item.variants[index] };
  }

  function ownerClass(copy) {
    return copy.owner ? classes.find((c) => c.id === copy.owner) || null : null;
  }

  // « Stuff A & Stuff B », « Stock de Lady-Vision », « Stock commun »…
  function copyLabel(copy) {
    if (copy.links.length) {
      return copy.links.map((l) => {
        const r = resolveLink(l, copy.itemId);
        return r.error ? r.error : stuffLabel(r.stuff);
      }).join(" & ");
    }
    if (!copy.owner) return "Stock commun";
    const cls = ownerClass(copy);
    return cls ? "Stock de " + cls.name : "Personnage supprimé (stock commun)";
  }

  function linksTo(copy, cls, stuff, item) {
    return copy.links.some((l) => l.cls === cls.id && l.stuff === stuff.id && l.slot === item.slot);
  }

  // Besoin total par ressource de toute la liste.
  function totalNeeds() {
    const needs = {};
    craft.copies.forEach((copy) => {
      const recipe = recipeOf(copy.itemId);
      if (recipe) recipe.ingredients.forEach(([id, q]) => { needs[id] = (needs[id] || 0) + q; });
    });
    return needs;
  }

  // Après un retrait : plus de compteur pour une ressource qui ne sert plus, et jamais au-delà du besoin.
  function normalizeCounters() {
    const needs = totalNeeds();
    Object.keys(craft.counters).forEach((id) => {
      if (!needs[id]) delete craft.counters[id];
      else if (craft.counters[id] > needs[id]) craft.counters[id] = needs[id];
    });
  }

  function setCounter(id, value, needs) {
    const max = needs[id] || 0;
    const n = Math.max(0, Math.min(max, Math.round(value) || 0));
    if (n) craft.counters[id] = n; else delete craft.counters[id];
  }

  // --- Ajout depuis un équipement ---------------------------------------------------
  // Case à côté d'une variante « À obtenir » qui a une recette : l'ajoute à la liste (ou l'en retire).
  function craftToggle(cls, stuff, item, index) {
    const btn = el("button", { type: "button", class: "craft-toggle" });
    let locked = false;
    const update = () => {
      const variant = item.variants[index];
      const id = variant && gameIdOf(variant);
      const linked = id && craft.copies.some((c) => c.itemId === id && linksTo(c, cls, stuff, item));
      const status = variantStatusOf(cls, stuff, item, index);
      btn.hidden = !canSave || !id || !recipeOf(id) || (status !== "missing" && !linked);
      btn.setAttribute("aria-pressed", String(!!linked));
      btn.title = linked ? "Dans la liste de fabrication\nClic : retirer" : "Ajouter à la liste de fabrication";
      btn.setAttribute("aria-label", (variant ? variant.name : "") + (linked ? " : retirer de la fabrication" : " : ajouter à la fabrication"));
    };
    btn.addEventListener("click", async () => {
      // Petit délai entre deux clics : un double clic n'ajoute pas puis retire aussitôt.
      if (locked) return;
      locked = true;
      btn.classList.add("locked");
      setTimeout(() => { locked = false; btn.classList.remove("locked"); }, 700);
      await toggleCraftLink(cls, stuff, item, index);
      update();
    });
    update();
    btn.update = update;
    return btn;
  }

  async function toggleCraftLink(cls, stuff, item, index) {
    const itemId = gameIdOf(item.variants[index]);
    const link = { cls: cls.id, stuff: stuff.id, slot: item.slot };
    const linked = craft.copies.find((c) => c.itemId === itemId && linksTo(c, cls, stuff, item));
    if (linked) {
      prepareSave(CRAFT_LOG);
      linked.links = linked.links.filter((l) => !(l.cls === cls.id && l.stuff === stuff.id && l.slot === item.slot));
      // Exemplaire créé depuis les stuffs : sans lien, il n'a plus lieu d'être.
      if (!linked.links.length) craft.copies.splice(craft.copies.indexOf(linked), 1);
      normalizeCounters();
      scheduleSave("craft", CRAFT_LOG);
      return;
    }
    // Même objet déjà lié à un autre stuff du personnage : nouvel exemplaire, ou le même ?
    const reusable = craft.copies.filter((c) => c.itemId === itemId && c.owner === cls.id && c.links.length);
    let target = null;
    if (reusable.length) {
      const choice = await chooseOption("Objet déjà dans la fabrication",
        "« " + itemName(itemId) + " » est déjà lié à un autre équipement de " + cls.name + ". "
        + "Voulez-vous ajouter un exemplaire supplémentaire ou réutiliser l'exemplaire lié à l'équipement précédent ?",
        [{ value: "new", text: "Ajouter un exemplaire supplémentaire", primary: true },
          ...reusable.map((c, i) => ({ value: i, text: "Réutiliser l'exemplaire de " + copyLabel(c) }))]);
      if (choice === null) return;
      if (choice !== "new") target = reusable[choice];
    }
    prepareSave(CRAFT_LOG);
    if (target) target.links.push(link);
    else craft.copies.push({ id: newCopyId(), itemId, seq: ++craft.seq, owner: cls.id, links: [link] });
    scheduleSave("craft", CRAFT_LOG);
  }

  // Une variante liée passée en « Fabriqué » ou « Possédé » depuis son stuff : son exemplaire quitte la liste.
  function craftOnStatusChange(cls, stuff, item, index, status) {
    if (status === "missing") return;
    const itemId = gameIdOf(item.variants[index]);
    const done = craft.copies.filter((c) => c.itemId === itemId && linksTo(c, cls, stuff, item));
    if (!done.length) return;
    done.forEach((c) => craft.copies.splice(craft.copies.indexOf(c), 1));
    normalizeCounters();
    scheduleSave("craft");
  }

  // Fenêtre de choix générique : résout la valeur choisie, ou null si annulée.
  const choiceDialog = document.getElementById("choice-dialog");
  let choiceResolve = null;

  function chooseOption(title, text, options) {
    document.getElementById("choice-title").textContent = title;
    document.getElementById("choice-text").textContent = text;
    document.getElementById("choice-options").replaceChildren(...options.map((o) => {
      const b = el("button", { type: "button", class: "btn" + (o.primary ? " btn-primary" : ""), text: o.text });
      b.addEventListener("click", () => { const r = choiceResolve; choiceResolve = null; choiceDialog.close(); r(o.value); });
      return b;
    }));
    choiceDialog.showModal();
    return new Promise((resolve) => { choiceResolve = resolve; });
  }

  choiceDialog.addEventListener("close", () => { if (choiceResolve) { const r = choiceResolve; choiceResolve = null; r(null); } });
  choiceDialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => choiceDialog.close()));
  choiceDialog.addEventListener("click", (e) => { if (e.target === choiceDialog) choiceDialog.close(); });

  // --- Ajout depuis la liste (fenêtre) ---------------------------------------------------
  const craftDialog = document.getElementById("craft-dialog");
  const craftForm = document.getElementById("craft-form");
  const craftItemBtn = document.getElementById("craft-item");
  let craftDraft = null;

  craftForm.elements.category.append(...window.BANK_BUILD.CATEGORIES.map((c) => el("option", { value: c, text: c })));

  function openCraftForm() {
    craftDraft = { category: window.BANK_BUILD.CATEGORIES[0], itemId: null };
    craftForm.elements.category.value = craftDraft.category;
    craftForm.elements.quantity.value = 1;
    craftForm.elements.owner.replaceChildren(
      el("option", { value: "", text: "Stock commun" }),
      ...classes.map((c) => el("option", { value: c.id, text: c.name + (c.name !== c.class ? " (" + c.class + ")" : "") })),
    );
    craftForm.elements.owner.value = "";
    craftForm.querySelector(".form-error").textContent = "";
    renderCraftDraft();
    craftDialog.showModal();
  }

  function renderCraftDraft() {
    const game = craftDraft.itemId && itemsById.get(craftDraft.itemId);
    craftItemBtn.replaceChildren(...(game
      ? [itemIcon(game.id), el("span", {}, [game.name, legendaryStar(game.legendary)])]
      : [el("span", { class: "placeholder", text: "Choisir un objet…" })]));
  }

  craftForm.elements.category.addEventListener("change", () => {
    craftDraft.category = craftForm.elements.category.value;
    const game = craftDraft.itemId && itemsById.get(craftDraft.itemId);
    if (game && !typesForCategory(craftDraft.category).includes(game.typeId)) craftDraft.itemId = null;
    renderCraftDraft();
  });

  craftItemBtn.addEventListener("click", () => {
    openItemPicker(craftDraft.category + " — fabrication", {
      types: typesForCategory(craftDraft.category),
      filter: (game) => !!recipeOf(game.id),
      selectedId: craftDraft.itemId,
      onChoose: (game) => { craftDraft.itemId = game.id; renderCraftDraft(); },
    });
  });

  craftForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const error = craftForm.querySelector(".form-error");
    const quantity = Number(craftForm.elements.quantity.value);
    if (!craftDraft.itemId) { error.textContent = "Choisis un objet."; return; }
    if (!Number.isInteger(quantity) || quantity < 1) { error.textContent = "La quantité doit être un nombre entier positif."; return; }
    const owner = craftForm.elements.owner.value || null;
    prepareSave({ log: "fabrication", label: "Ajouté : " + quantity + " × " + itemName(craftDraft.itemId) });
    for (let i = 0; i < quantity; i++) {
      craft.copies.push({ id: newCopyId(), itemId: craftDraft.itemId, seq: ++craft.seq, owner, links: [] });
    }
    craftDialog.close();
    scheduleSave("craft", CRAFT_LOG);
    render();
  });
  craftDialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => craftDialog.close()));
  craftDialog.addEventListener("click", (e) => { if (e.target === craftDialog) craftDialog.close(); });

  // --- Valider / supprimer : quantité et exemplaires ------------------------------------
  const qtyDialog = document.getElementById("craft-qty-dialog");
  const qtyForm = document.getElementById("craft-qty-form");
  let qtyAction = null; // { copies, onConfirm }

  // Plusieurs exemplaires : quantité (bouton Max) ; si elle est inférieure au total, choix des exemplaires.
  function askCopies(title, submitText, copies, onConfirm) {
    if (copies.length === 1) {
      if (confirm(title + " : « " + itemName(copies[0].itemId) + " » (" + copyLabel(copies[0]) + ") ?")) onConfirm(copies);
      return;
    }
    qtyAction = { copies, onConfirm };
    document.getElementById("craft-qty-title").textContent = title;
    document.getElementById("craft-qty-text").textContent = itemName(copies[0].itemId) + " : " + copies.length + " exemplaires dans la liste.";
    document.getElementById("craft-qty-total").textContent = "/ " + copies.length;
    document.getElementById("craft-qty-submit").textContent = submitText;
    qtyForm.elements.quantity.max = String(copies.length);
    qtyForm.elements.quantity.value = String(copies.length);
    qtyForm.querySelector(".form-error").textContent = "";
    document.getElementById("craft-qty-copies").replaceChildren(...copies.map((c, i) => el("label", { class: "target" }, [
      el("input", { type: "checkbox", name: "copy", value: String(i) }),
      el("span", { text: "Exemplaire " + (i + 1) + " : " + copyLabel(c) }),
    ])));
    syncQtyCopies();
    qtyDialog.showModal();
  }

  // Les exemplaires cochés suivent la quantité (les premiers par défaut) ; masqués si tout est concerné.
  function syncQtyCopies() {
    const n = Number(qtyForm.elements.quantity.value) || 0;
    const all = n >= qtyAction.copies.length;
    document.getElementById("craft-qty-copies-field").hidden = all;
    const boxes = [...qtyForm.querySelectorAll('input[name="copy"]')];
    boxes.forEach((b, i) => { b.checked = i < n; });
  }

  qtyForm.elements.quantity.addEventListener("input", syncQtyCopies);
  document.getElementById("craft-qty-max").addEventListener("click", () => {
    qtyForm.elements.quantity.value = String(qtyAction.copies.length);
    syncQtyCopies();
  });
  qtyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const error = qtyForm.querySelector(".form-error");
    const n = Number(qtyForm.elements.quantity.value);
    if (!Number.isInteger(n) || n < 1 || n > qtyAction.copies.length) { error.textContent = "Quantité entre 1 et " + qtyAction.copies.length + "."; return; }
    const chosen = n === qtyAction.copies.length
      ? qtyAction.copies
      : [...qtyForm.querySelectorAll('input[name="copy"]:checked')].map((b) => qtyAction.copies[Number(b.value)]);
    if (chosen.length !== n) { error.textContent = "Coche " + n + " exemplaire" + (n > 1 ? "s" : "") + " (" + chosen.length + " coché" + (chosen.length > 1 ? "s" : "") + ")."; return; }
    qtyDialog.close();
    qtyAction.onConfirm(chosen);
  });
  qtyDialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => qtyDialog.close()));
  qtyDialog.addEventListener("click", (e) => { if (e.target === qtyDialog) qtyDialog.close(); });

  // Fabriqués : ressources consommées, « Fabriqué » sur les stuffs liés, sinon dans le stock (du personnage ou commun).
  function validateCopies(copies) {
    prepareSave({ log: "fabrication", label: "Fabriqué : " + copies.length + " × " + itemName(copies[0].itemId) });
    copies.forEach((copy) => {
      const recipe = recipeOf(copy.itemId);
      if (recipe) recipe.ingredients.forEach(([id, q]) => {
        const left = (craft.counters[id] || 0) - q;
        if (left > 0) craft.counters[id] = left; else delete craft.counters[id];
      });
      craft.copies.splice(craft.copies.indexOf(copy), 1);

      const targets = copy.links.map((l) => resolveLink(l, copy.itemId)).filter((r) => !r.error);
      targets.forEach((r) => { if (r.variant.status === "missing") r.variant.status = "crafted"; });
      if (!targets.length) {
        const owner = ownerClass(copy) ? copy.owner : null;
        const game = itemsById.get(copy.itemId);
        const same = stock.find((l) => l.status === "crafted" && (l.owner || null) === owner && !l.bonuses.length
          && l.variants.length === 1 && l.variants[0].itemId === copy.itemId);
        if (same) same.quantity += 1;
        else {
          stock.push(Object.assign({
            id: newStockId(),
            category: categoryOfType(game ? game.typeId : 0),
            variants: [{ name: itemName(copy.itemId), itemId: copy.itemId }],
            bonuses: [],
            quantity: 1,
            status: "crafted",
          }, owner ? { owner } : {}));
        }
      }
    });
    normalizeCounters();
    scheduleSave(["craft", "stuffs", "stock"], CRAFT_LOG);
    render();
  }

  // Supprimés de la liste seulement : les stuffs liés ne changent pas, les compteurs restent (dans la limite du besoin).
  function deleteCopies(copies) {
    prepareSave({ log: "fabrication", label: "Supprimé de la liste : " + copies.length + " × " + itemName(copies[0].itemId) });
    copies.forEach((copy) => craft.copies.splice(craft.copies.indexOf(copy), 1));
    normalizeCounters();
    scheduleSave("craft", CRAFT_LOG);
    render();
  }

  // --- Vue « Fabrication » ---------------------------------------------------------------
  function readSetting(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }

  function writeSetting(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* stockage indisponible */ }
  }

  // Blocs d'objets selon le tri : un par objet (tri par métier) ou par objet, personnage et stuff.
  function craftBlocks(sort) {
    const blocks = new Map();
    craft.copies.forEach((copy) => {
      let key = String(copy.itemId);
      let group = null;
      let sub = null;
      if (sort === "character") {
        const cls = ownerClass(copy);
        const link = copy.links.map((l) => resolveLink(l, copy.itemId)).find((r) => r.stuff);
        group = cls ? cls.id : copy.owner ? "deleted" : "common";
        sub = link ? link.stuff.id : "stock";
        key += "|" + group + "|" + sub;
      }
      if (!blocks.has(key)) blocks.set(key, { key, itemId: copy.itemId, group, sub, copies: [] });
      blocks.get(key).copies.push(copy);
    });
    const list = [...blocks.values()];
    list.forEach((b) => {
      b.copies.sort((x, y) => (x.seq || 0) - (y.seq || 0));
      b.seq = b.copies[0].seq || 0;
    });
    // Répartition des compteurs : par ordre d'ajout (puis identifiant d'objet), toujours le même.
    list.sort((a, b) => a.seq - b.seq || a.itemId - b.itemId);
    const left = Object.assign({}, craft.counters);
    list.forEach((b) => {
      const recipe = recipeOf(b.itemId);
      b.resources = (recipe ? recipe.ingredients : []).map(([id, q]) => {
        const need = q * b.copies.length;
        const have = Math.min(left[id] || 0, need);
        left[id] = (left[id] || 0) - have;
        return { id, need, have };
      });
      b.complete = b.resources.every((r) => r.have >= r.need);
    });
    return list;
  }

  function resourceInfo(id) {
    return recipesData.ingredients[id] || { name: "Ressource " + id, level: 0, type: "Autres", icon: "" };
  }

  // Ligne d'une ressource : icône, nom, compteur modifiable « x / besoin », Max et remise à zéro.
  function resourceRow(id, have, need, onSet, query) {
    const info = resourceInfo(id);
    const input = el("input", { type: "number", class: "craft-count", min: "0", max: String(need), step: "1", "aria-label": info.name + " : quantité possédée" });
    input.value = String(have);
    const icon = el("img", { class: "icon", src: info.icon, alt: "", loading: "lazy" });
    // Icône pas encore téléchargée sur cette installation : celle de DofusDB.
    icon.addEventListener("error", () => { icon.src = DOFUSDB_IMG_URL + info.icon.split("/").pop(); }, { once: true });
    const row = el("div", { class: "craft-res" + (have >= need ? " done" : "") }, [
      icon,
      el("span", { class: "craft-res-name", title: info.name + (info.level ? " — niv. " + info.level : "") + (info.type ? " — " + info.type : "") }, [highlight(info.name, query)]),
      el("span", { class: "craft-res-count" }, [input, el("span", { class: "craft-res-need", text: "/ " + need })]),
    ]);
    if (!canSave) {
      input.disabled = true;
      return row;
    }
    input.addEventListener("change", () => onSet(Number(input.value)));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    const max = el("button", { type: "button", class: "btn btn-small craft-max", title: "Mettre au maximum (" + need + ")", text: "Max" });
    max.addEventListener("click", () => onSet(need));
    const reset = el("button", { type: "button", class: "btn btn-small craft-reset", title: "Remettre à 0", "aria-label": "Remettre " + info.name + " à 0", text: "↺" });
    reset.addEventListener("click", () => onSet(0));
    row.append(max, reset);
    return row;
  }

  // Modifier un compteur, globalement (récapitulatif) ou par la part d'un objet (bloc d'objet).
  function changeCounter(id, value) {
    prepareSave(CRAFT_LOG);
    setCounter(id, value, totalNeeds());
    scheduleSave("craft", CRAFT_LOG);
    render();
  }

  function renderCraftResources(query) {
    const needs = totalNeeds();
    const hide = readSetting(CRAFT_HIDE_KEY, "") === "1";
    const ids = Object.keys(needs);
    const doneCount = ids.filter((id) => (craft.counters[id] || 0) >= needs[id]).length;
    const visible = ids.filter((id) => !(hide && (craft.counters[id] || 0) >= needs[id]))
      .filter((id) => !query || normalize(resourceInfo(id).name).includes(query));
    const byType = new Map();
    visible.forEach((id) => {
      const type = resourceInfo(id).type || "Autres";
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(id);
    });
    const groups = [...byType].sort(([a], [b]) => a.localeCompare(b, "fr")).map(([type, list]) => el("section", { class: "craft-res-group" }, [
      el("h4", { class: "group-title", text: type + " · " + list.length }),
      el("div", { class: "craft-res-grid" }, list
        .sort((a, b) => resourceInfo(a).level - resourceInfo(b).level || resourceInfo(a).name.localeCompare(resourceInfo(b).name, "fr"))
        .map((id) => resourceRow(id, craft.counters[id] || 0, needs[id], (v) => changeCounter(id, v), query))),
    ]));

    const hideBox = el("input", { type: "checkbox" });
    hideBox.checked = hide;
    hideBox.addEventListener("change", () => { writeSetting(CRAFT_HIDE_KEY, hideBox.checked ? "1" : "0"); render(); });
    const options = el("div", { class: "craft-options" }, [el("label", { class: "craft-check" }, [hideBox, el("span", { text: "Masquer les ressources complétées" })])]);
    const body = ids.length
      ? [options, ...(groups.length ? [el("div", { class: "craft-res-columns" }, groups)] : [el("p", { class: "empty craft-empty", text: hide && !query ? "Toutes les ressources sont complétées." : "Aucune ressource ne correspond à la recherche." })])]
      : [];
    return collapsible("craft-resources", "craft-resources", [
      el("h3", { text: "Récapitulatif des ressources" }),
      el("span", { class: "meta", text: ids.length ? doneCount + " / " + ids.length + " ressources complètes" : "Aucune ressource nécessaire" }),
    ], body);
  }

  // Personnages (icônes) d'un bloc ; au survol : « Exemplaire 1 : Stuff A & Stuff B ».
  function blockOwners(block) {
    const byOwner = new Map();
    block.copies.forEach((copy) => {
      const cls = ownerClass(copy);
      const key = cls ? cls.id : copy.owner ? "deleted" : "common";
      if (!byOwner.has(key)) byOwner.set(key, { cls, copies: [] });
      byOwner.get(key).copies.push(copy);
    });
    return el("span", { class: "craft-owners" }, [...byOwner].map(([key, o]) => {
      const title = (o.cls ? o.cls.name : key === "deleted" ? "Personnage supprimé" : "Stock commun") + "\n"
        + o.copies.map((c, i) => "Exemplaire " + (i + 1) + " : " + copyLabel(c)).join("\n");
      return o.cls
        ? el("span", { class: "craft-owner", title }, [el("img", { src: classIcon(o.cls.class), alt: o.cls.name }), o.copies.length > 1 ? el("span", { class: "craft-owner-qty", text: "×" + o.copies.length }) : null])
        : el("span", { class: "craft-owner craft-owner-text", title, text: (key === "deleted" ? "Personnage supprimé" : "Commun") + (o.copies.length > 1 ? " ×" + o.copies.length : "") });
    }));
  }

  function renderCraftBlock(block, query) {
    const game = itemsById.get(block.itemId);
    const recipe = recipeOf(block.itemId);
    const job = recipe && recipesData.jobs[recipe.jobId];
    const head = el("div", { class: "craft-item-head" }, [
      itemIcon(block.itemId),
      el("div", { class: "craft-item-title" }, [
        el("span", { class: "name" }, [highlight(itemName(block.itemId), query), legendaryStar(game && game.legendary)]),
        el("span", { class: "craft-item-meta" }, [
          game ? el("span", { text: "niv. " + game.level }) : null,
          job ? el("span", { class: "craft-job", title: job.name }, [el("img", { src: job.icon, alt: "" }), job.name]) : null,
        ]),
      ]),
      el("span", { class: "craft-qty", title: block.copies.length + " à fabriquer", text: "×" + block.copies.length }),
      blockOwners(block),
    ]);
    const resources = el("div", { class: "craft-res-list" }, block.resources.map((r) => resourceRow(r.id, r.have, r.need, (v) => {
      // La part de cet objet change : le compteur global suit la différence.
      changeCounter(r.id, (craft.counters[r.id] || 0) + (Math.max(0, Math.min(r.need, v)) - r.have));
    }, query)));
    const parts = [head, resources];
    if (canSave) {
      const validate = el("button", { type: "button", class: "btn btn-small btn-primary", text: "Valider" });
      validate.addEventListener("click", () => askCopies("Valider la fabrication", "Valider", block.copies, validateCopies));
      const remove = el("button", { type: "button", class: "btn btn-small btn-danger", text: "Supprimer" });
      remove.addEventListener("click", () => askCopies("Supprimer de la liste", "Supprimer", block.copies, deleteCopies));
      parts.push(el("div", { class: "craft-item-actions" }, [validate, remove]));
    }
    return el("article", { class: "craft-item" + (block.complete ? " done" : "") }, parts);
  }

  function renderCraftItems(query) {
    const sort = CRAFT_SORTS[readSetting(CRAFT_SORT_KEY, "job")] ? readSetting(CRAFT_SORT_KEY, "job") : "job";
    const blocks = craftBlocks(sort).filter((b) => !query
      || normalize(itemName(b.itemId)).includes(query)
      || b.resources.some((r) => normalize(resourceInfo(r.id).name).includes(query)));

    // Groupes (métier ou personnage) puis sous-groupes (type d'objet ou stuff).
    const groupOf = (b) => {
      if (sort === "character") {
        // Personnages dans leur ordre, puis personnages supprimés et stock commun en fin de liste.
        if (b.group === "common") return { key: "9999", label: "Stock commun" };
        if (b.group === "deleted") return { key: "9998", label: "Personnage supprimé" };
        const cls = classes.find((c) => c.id === b.group);
        return { key: String(classes.indexOf(cls)).padStart(4, "0"), label: cls.name, cls };
      }
      const recipe = recipeOf(b.itemId);
      const job = recipe && recipesData.jobs[recipe.jobId];
      return { key: job ? job.name : "￿", label: job ? job.name : "Sans métier", job };
    };
    const subOf = (b) => {
      if (sort === "character") {
        if (b.sub === "stock") return { key: "9999", label: b.group === "common" ? "Stock commun" : "Stock du personnage" };
        const cls = classes.find((c) => c.id === b.group) || classes.find((c) => c.stuffs.some((s) => s.id === b.sub));
        const stuff = cls && cls.stuffs.find((s) => s.id === b.sub);
        return { key: String(cls ? cls.stuffs.indexOf(stuff) : 0).padStart(4, "0"), label: stuff ? stuffLabel(stuff) : "Stuff" };
      }
      const game = itemsById.get(b.itemId);
      const category = categoryOfType(game ? game.typeId : 0);
      return { key: String(window.BANK_BUILD.CATEGORIES.indexOf(category)).padStart(4, "0"), label: category };
    };
    const groups = new Map();
    blocks.forEach((b) => {
      const g = groupOf(b);
      const s = subOf(b);
      if (!groups.has(g.key)) groups.set(g.key, { ...g, subs: new Map() });
      const subs = groups.get(g.key).subs;
      if (!subs.has(s.key)) subs.set(s.key, { ...s, blocks: [] });
      subs.get(s.key).blocks.push(b);
    });

    const sortSelect = el("select", { "aria-label": "Tri des objets" }, Object.entries(CRAFT_SORTS).map(([value, text]) => el("option", { value, text: "Tri : " + text })));
    sortSelect.value = sort;
    sortSelect.addEventListener("change", () => { writeSetting(CRAFT_SORT_KEY, sortSelect.value); render(); });

    const sections = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key, "fr")).map((g) => el("section", { class: "craft-group" }, [
      el("h4", { class: "craft-group-title" }, [
        g.cls ? el("img", { src: classIcon(g.cls.class), alt: "" }) : g.job ? el("img", { src: g.job.icon, alt: "" }) : null,
        el("span", { text: g.label }),
      ]),
      ...[...g.subs.values()].sort((a, b) => a.key.localeCompare(b.key, "fr")).map((s) => el("div", { class: "craft-sub" }, [
        el("h5", { class: "group-title", text: s.label + " · " + s.blocks.reduce((n, b) => n + b.copies.length, 0) }),
        el("div", { class: "craft-items" }, s.blocks.map((b) => renderCraftBlock(b, query))),
      ])),
    ]));

    const total = craft.copies.length;
    const body = total
      ? [el("div", { class: "craft-options" }, [sortSelect]), ...(sections.length ? sections : [el("p", { class: "empty craft-empty", text: "Aucun objet ne correspond à la recherche." })])]
      : [el("p", { class: "empty craft-empty", text: "La liste est vide : ajoute un objet avec « + Ajouter à la liste », ou depuis un stuff avec le bouton ⚒ d'un objet à obtenir." })];
    return collapsible("craft-items", "craft-items-box", [
      el("h3", { text: "Liste des objets" }),
      el("span", { class: "meta", text: total + " objet" + (total > 1 ? "s" : "") + " à fabriquer" }),
    ], body);
  }

  function renderCraft(query) {
    nav.replaceChildren();
    const total = craft.copies.length;
    const complete = craftBlocks("job").filter((b) => b.complete).length;
    const title = el("div", { class: "character-title" }, [el("h2", { text: "Fabrication" })]);
    if (canSave) {
      const add = el("button", { type: "button", class: "btn btn-small btn-primary", text: "+ Ajouter à la liste" });
      add.addEventListener("click", openCraftForm);
      title.append(add);
    }
    const history = el("a", { href: "#historique-fabrication", text: "Historique de la fabrication" });
    content.replaceChildren(
      el("div", { class: "class-head" }, [el("div", {}, [
        title,
        el("p", {}, [total + " objet" + (total > 1 ? "s" : "") + " à fabriquer · " + complete + " prêt" + (complete > 1 ? "s" : "") + " (toutes ressources réunies) · ", history]),
      ])]),
      renderCraftResources(query),
      renderCraftItems(query),
    );
  }

  // Vue courante d'après l'adresse : #banque, #tags, sinon une classe (#Eniripsa…).
  const VIEW_HASHES = { banque: "bank", fabrication: "craft", tags: "tags", historique: "history", "historique-fabrication": "history" };

  // Historique affiché : général, ou celui de la fabrication (#historique-fabrication).
  function historyLog() {
    return location.hash.slice(1) === "historique-fabrication" ? "fabrication" : "general";
  }

  function currentView() {
    return VIEW_HASHES[location.hash.slice(1)] || "stuffs";
  }

  function renderTabs() {
    const view = currentView();
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.setAttribute("aria-current", String(tab.dataset.view === view));
      if (tab.dataset.view === "stuffs") tab.href = "#" + encodeURIComponent(current || "");
    });
  }

  function render() {
    const query = normalize(search.value.trim());
    const view = currentView();
    document.body.dataset.view = view;
    document.body.classList.toggle("editing", editing);
    renderTabs();
    if (view === "bank") { renderBank(query); return; }
    if (view === "tags") { renderTagLibrary(query); return; }
    if (view === "history") { renderHistory(query); return; }
    if (view === "craft") { renderCraft(query); return; }

    const cls = classes.find((c) => c.name === current) || classes[0];
    if (!cls) {
      renderNav(query);
      content.replaceChildren(el("p", { class: "empty", text: "Aucun personnage : en ajouter un avec « Modifier » puis « + Personnage »." }));
      return;
    }
    current = cls.name;
    renderTabs();
    renderNav(query);

    const cards = cls.stuffs.map((s) => renderStuff(cls, s, query)).filter(Boolean);
    const parts = [
      renderCharacterHead(cls),
      renderCharacterScrolls(cls),
      renderCharacterSpells(cls),
      renderCharacterStock(cls, query),
      cards.length
        ? el("div", { class: "stuffs" }, cards)
        : el("p", { class: "empty", text: cls.stuffs.length
          ? "Aucun objet ne correspond à la recherche pour cette classe."
          : "Aucun stuff pour cette classe." }),
    ];
    if (editing) {
      const addStuff = el("button", { type: "button", class: "stuff-add", text: "+ Nouveau stuff" });
      addStuff.addEventListener("click", () => openStuffForm(cls, null));
      parts.push(addStuff);
    }
    content.replaceChildren(...parts.filter(Boolean));
  }

  if (canSave) {
    editBtn.addEventListener("click", () => {
      editing = !editing;
      editBtn.setAttribute("aria-pressed", String(editing));
      editBtn.textContent = editing ? "Terminer" : "Modifier";
      render();
    });
  } else {
    editBtn.disabled = true;
    editBtn.title = "Lancer « npm start » puis ouvrir l'adresse affichée (http://127.0.0.1:4310) pour modifier les stuffs.";
  }

  search.addEventListener("input", render);
  window.addEventListener("hashchange", () => {
    if (currentView() === "history") historyEntries = null;
    if (currentView() === "stuffs") current = decodeURIComponent(location.hash.slice(1)) || current;
    render();
  });
  ensureStuffIds();
  migrateCharacters();
  migrateStatus();
  migrateBonuses();
  splitRemovedStats();
  migrateOverrides();
  syncTagLibrary();
  if (canSave && (!exportedBank || window.BANK_BUILD.signature(exportedBank.entries) !== window.BANK_BUILD.signature(liveBank()))) {
    scheduleSave("bank");
  }
  render();
})();

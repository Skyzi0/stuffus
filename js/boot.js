// Charge les données du dossier choisi, puis l'application.
// Dossier : ?dossier=<id> dans l'adresse, sinon le dernier ouvert, sinon le premier de data/folders.js.
(function () {
  const STORAGE_KEY = "tracking-stuff:folder";
  const folders = window.FOLDERS || [];
  let remembered = null;
  try { remembered = localStorage.getItem(STORAGE_KEY); } catch (e) { /* stockage indisponible */ }
  const wanted = new URLSearchParams(location.search).get("dossier") || remembered;
  const folder = folders.find((f) => f.id === wanted) || folders[0] || null;

  window.CURRENT_FOLDER = folder;
  if (folder) {
    try { localStorage.setItem(STORAGE_KEY, folder.id); } catch (e) { /* stockage indisponible */ }
  }

  // Sans dossiers (anciennes données, avant le premier démarrage du serveur) : fichiers à la racine de data/.
  const base = folder ? "data/folders/" + encodeURIComponent(folder.id) + "/" : "data/";
  [base + "stuffs.js", base + "bank.js", base + "stock.js", base + "craft.js", "js/app.js"].forEach((src) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false; // exécutés dans l'ordre
    document.body.appendChild(script);
  });
})();

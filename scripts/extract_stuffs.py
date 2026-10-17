"""Extrait les stuffs par classe depuis l'export Google Sheets Team/Stuffs.html.

Génère data/stuffs.js (chargeable directement par index.html, même en file://).

Usage : python scripts/extract_stuffs.py [--dossier <id>] [--force]
  --dossier : dossier de destination (par défaut : le premier de data/folders.js)
  --force   : écrase aussi un stuffs.js modifié depuis le site.
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "Team" / "Stuffs.html"
# Présent dans l'en-tête de stuffs.js quand server.js l'a réécrit.
EDITED_MARKER = "modifié depuis le site"

# Chaque classe occupe un bloc de 5 colonnes : libellé, objet, bonus, case « obtenu », séparateur.
BLOCK_WIDTH = 5
FIRST_BLOCK_COL = 2


def parse_grid(source):
    """Retourne {(ligne, colonne): {"text", "href", "img"}} en tenant compte des colspan."""
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", source, re.S)
    grid = {}
    for r, row in enumerate(rows):
        col = 0
        for attrs, content in re.findall(r"<t[dh]([^>]*)>(.*?)</t[dh]>", row, re.S):
            span = re.search(r'colspan="(\d+)"', attrs)
            href = re.search(r'href="([^"]+)"', content)
            img = re.search(r'<img[^>]*src="([^"]+)"', content)
            checkbox = re.search(r'href="#(checked|unchecked)-checkbox-id"', content)
            grid[(r, col)] = {
                "text": html.unescape(re.sub(r"<[^>]+>", "", content)).strip(),
                "href": html.unescape(href[1]) if href and not checkbox else None,
                "img": img[1] if img else None,
                "checked": checkbox[1] == "checked" if checkbox else None,
            }
            col += int(span[1]) if span else 1
    return grid


def text(grid, r, c):
    cell = grid.get((r, c))
    return cell["text"] if cell else ""


def split_name(raw):
    """Le ⭐ dans le tableau marque un objet spécial : on le sort du nom."""
    starred = "⭐" in raw
    return raw.replace("⭐", "").strip(), starred


# Abréviations utilisées après « w/ » (statistique à retirer de l'objet).
REMOVED_STAT_NAMES = {"ini": "Initiative", "vita": "Vitalité", "sa": "Sagesse", "pros": "Prospection"}


def parse_bonus(raw):
    """« Trans 8 Do Crit w/ Ini » -> bonus « Trans 8 Do Crit » + stat retirée « Initiative »."""
    base, *removed = re.split(r"\s*w/\s*", raw, flags=re.I)
    bonuses = [{"text": base, "kind": bonus_kind(base)}] if base else []
    for part in removed:
        for stat in re.split(r"\s*,\s*", part):
            if stat:
                bonuses.append({"text": REMOVED_STAT_NAMES.get(stat.lower(), stat), "kind": "removed"})
    return bonuses


def bonus_kind(bonus):
    if not bonus:
        return None
    if bonus.lower().startswith("trans"):
        return "trans"
    if bonus.lower().startswith("over"):
        return "over"
    return "exo"


def parse_stuff(grid, start_row, label_col):
    """Lit un stuff dont la ligne « Stuff » est start_row."""
    stuff = {"name": text(grid, start_row, label_col + 1), "link": None, "initiative": None, "items": []}
    r = start_row + 1
    while text(grid, r, label_col):
        label = text(grid, r, label_col)
        value_cell = grid.get((r, label_col + 1)) or {}
        if label == "Lien DB":
            stuff["link"] = value_cell.get("href") or value_cell.get("text")
        elif label.startswith("Initia"):
            stuff["initiative"] = int(value_cell["text"]) if value_cell.get("text", "").isdigit() else None
        else:
            # « A / B » dans une cellule = deux variantes possibles pour le même emplacement.
            variants = [split_name(v) for v in value_cell.get("text", "").split(" / ") if v.strip()]
            # « PM + Critique » = deux bonus distincts.
            bonuses = [b.strip() for b in text(grid, r, label_col + 2).split("+") if b.strip()]
            # Le Sheet n'a qu'une case par ligne (ni état « fabriqué », ni état par variante).
            status = "owned" if (grid.get((r, label_col + 3)) or {}).get("checked") else "missing"
            stuff["items"].append({
                "slot": "Arme" if label == "Arrme" else label,
                "variants": [
                    {"name": n, "starred": s, "status": status, "bonuses": [p for b in bonuses for p in parse_bonus(b)]}
                    for n, s in variants
                ],
            })
        r += 1
    return stuff


def output_path():
    """stuffs.js du dossier visé ; data/stuffs.js avant le premier démarrage du serveur (pas de dossiers)."""
    folders_file = ROOT / "data" / "folders.js"
    if not folders_file.exists():
        return ROOT / "data" / "stuffs.js"
    source = folders_file.read_text(encoding="utf-8")
    folders = json.loads(source[source.index("=") + 1:].strip().rstrip(";"))
    wanted = sys.argv[sys.argv.index("--dossier") + 1] if "--dossier" in sys.argv else folders[0]["id"]
    if not any(f["id"] == wanted for f in folders):
        sys.exit(f"Dossier inconnu : {wanted} (disponibles : {', '.join(f['id'] for f in folders)})")
    return ROOT / "data" / "folders" / wanted / "stuffs.js"


def main():
    OUT_JS = output_path()
    # Une fois les stuffs modifiés depuis le site, le Sheet n'est plus la source de vérité.
    if OUT_JS.exists() and EDITED_MARKER in OUT_JS.read_text(encoding="utf-8") and "--force" not in sys.argv:
        sys.exit(
            f"{OUT_JS.relative_to(ROOT)} a été modifié depuis le site : l'extraction écraserait ces modifications.\n"
            "Relancer avec --force pour repartir du Google Sheet."
        )

    grid = parse_grid(SOURCE.read_text(encoding="utf-8"))
    max_row = max(r for r, _ in grid)

    classes = []
    col = FIRST_BLOCK_COL
    while text(grid, 1, col + 1):
        name = text(grid, 1, col + 1)
        # Les icônes de classe sont les .png du dossier assets/classes (pas les images du Sheet).
        icon = f"assets/classes/{name.lower().replace('â', 'a')}.png"
        stuffs = [
            parse_stuff(grid, r, col)
            for r in range(2, max_row + 1)
            if text(grid, r, col) == "Stuff"
        ]
        classes.append({"name": name, "icon": icon, "stuffs": stuffs})
        col += BLOCK_WIDTH

    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(classes, ensure_ascii=False, indent=2)
    OUT_JS.write_text(
        "// Fichier généré par scripts/extract_stuffs.py — ne pas modifier à la main.\n"
        f"window.STUFFS = {payload};\n",
        encoding="utf-8",
    )
    total = sum(len(c["stuffs"]) for c in classes)
    print(f"{len(classes)} classes, {total} stuffs -> {OUT_JS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

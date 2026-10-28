#!/usr/bin/env python3
"""Fabrique un dépôt git local jetable de skins : un vrai skin « e2e-duo » (deux modes, police woff2, image PNG, mise en page en colonne, pièce de module)."""
import json, os, shutil, subprocess, sys
from PIL import Image, ImageDraw
OUT = sys.argv[1]
FONT = "/dev/shm/s7/node_modules/next/dist/next-devtools/server/font/geist-latin.woff2"
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
def g(*a): return subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", *a], cwd=OUT, check=True, capture_output=True, text=True).stdout

def skin(version, accent_light, accent_dark, heading):
    d = os.path.join(OUT, "skins", "e2e-duo")
    shutil.rmtree(d, ignore_errors=True)
    for sub in ("fonts", "images", "previews", "LICENSES"): os.makedirs(os.path.join(d, sub))
    shutil.copy(FONT, os.path.join(d, "fonts", "geist.woff2"))
    open(os.path.join(d, "LICENSES", "OFL.txt"), "w").write("SIL Open Font License 1.1 - Copyright (c) Vercel (Geist). Texte complet : https://openfontlicense.org\n")
    open(os.path.join(d, "LICENSES", "CC0.txt"), "w").write("Image du test, dédiée au domaine public (CC0 1.0).\n")
    im = Image.new("RGB", (64, 64), (214, 200, 170)); dr = ImageDraw.Draw(im)
    for i in range(0, 64, 8): dr.line([(0, i), (i, 0)], fill=(190, 172, 140), width=2)
    im.save(os.path.join(d, "images", "grain.png"))
    pv = Image.new("RGB", (640, 400), (244, 239, 228)); ImageDraw.Draw(pv).rectangle([0, 0, 120, 400], fill=(22, 19, 15)); pv.save(os.path.join(d, "previews", "home.webp"), "WEBP", quality=60)
    open(os.path.join(d, "README.md"), "w").write("# Duo de test\n\nUn skin de test à deux modes, avec une police et une image embarquées.\n")
    json.dump({
        "skinContract": 1, "id": "e2e-duo",
        "name": {"fr": "Duo de test", "en": "Test duo"},
        "description": {"fr": "Skin d'essai à deux modes : police et image embarquées, colonne latérale.", "en": "Two-mode test skin: embedded font and image, side column."},
        "version": version, "minCore": "0.3.0",
        "author": {"name": "Équipe de test"}, "license": "MIT",
        "tags": ["light", "dark", "sans", "bold"], "modes": ["light", "dark"],
        "tokens": "tokens.json", "stylesheet": "skin.css",
        "previews": [{"file": "previews/home.webp", "mode": "light", "width": 640, "alt": {"fr": "Accueil", "en": "Home"}}],
        "assets": [
            {"file": "fonts/geist.woff2", "kind": "font", "family": "Geist Test", "weight": "100 900", "style": "normal", "license": "OFL-1.1", "licenseFile": "LICENSES/OFL.txt", "author": "Vercel", "source": "https://github.com/vercel/geist-font"},
            {"file": "images/grain.png", "kind": "image", "license": "CC0-1.0", "licenseFile": "LICENSES/CC0.txt", "author": "Équipe de test", "source": "https://example.org/grain"},
        ],
        "defaults": {"headerLayout": "classic", "font": "skin"},
        "options": [], "breakpoints": [640], "supports": {"reducedMotion": True},
    }, open(os.path.join(d, "skin.json"), "w"), indent=2, ensure_ascii=False)
    json.dump({
        "light": {"--v-bg": "#f4efe4", "--v-surface": "#ffffff", "--v-fg": "#16130f", "--v-accent": accent_light, "--v-accent-fg": "#ffffff", "--v-muted": "#4a443a", "--v-line": "#16130f"},
        "dark": {"--v-bg": "#14110d", "--v-surface": "#1f1a14", "--v-fg": "#f4efe4", "--v-accent": accent_dark, "--v-accent-fg": "#14110d", "--v-muted": "#c9c0b0", "--v-line": "#f4efe4"},
        "common": {
            "--v-font": "\"Geist Test\", system-ui, sans-serif",
            "--sk-page-width": "40rem", "--sk-shell-columns": "15rem minmax(0, 1fr)", "--sk-shell-areas": "\"header banner\" \"header main\" \"header footer\"",
            "--sk-radius-card": "0", "--sk-radius-panel": "0", "--sk-radius-button": "0", "--sk-radius-chip": "0", "--sk-radius-field": "0", "--sk-radius-media": "0",
            "--sk-border-width": "3px", "--sk-border-width-strong": "3px", "--sk-shadow-card": "6px 6px 0 var(--v-line)",
            "--sk-heading-transform": heading,
        },
        "modules": {"thanks-wall": {"--sk-m-thanks-wall-card-radius": "0", "--sk-m-thanks-wall-card-shadow": "5px 5px 0 var(--v-line)", "--sk-m-thanks-wall-card-border": "var(--v-line)"}},
    }, open(os.path.join(d, "tokens.json"), "w"), indent=2)
    open(os.path.join(d, "skin.css"), "w").write("""@font-face { font-family: "Geist Test"; src: url(skin:fonts/geist.woff2) format("woff2"); font-weight: 100 900; font-style: normal; }
@media (min-width: 40rem) {
  [data-skin-region="shell"] { display: grid; align-items: start; min-height: 100vh; }
  [data-skin-region="header"] { position: sticky; top: 0; height: 100vh; overflow-y: auto; display: flex; flex-direction: column; flex-wrap: nowrap; align-items: stretch; justify-content: flex-start; gap: 1.5rem; background-color: var(--v-surface); background-image: url(skin:images/grain.png); border-bottom: 0; border-right: 3px solid var(--v-line); padding-block: 1.5rem; padding-inline: 1.25rem; }
  [data-skin-part="header-group"] { display: contents; }
  [data-skin-region="nav"] { width: 100%; }
  [data-skin-region="nav"] [data-skin-part="nav-list"] { flex-direction: column; flex-wrap: nowrap; row-gap: 0.25rem; column-gap: 0; }
  [data-skin-region="nav"] [data-skin-part="nav-link"] { display: flex; width: 100%; padding-block: 0.5rem; padding-inline: 0.75rem; border: 3px solid transparent; font-weight: var(--sk-weight-bold); color: var(--v-fg); }
  [data-skin-region="tools"] { display: flex; flex-direction: column; flex-wrap: nowrap; align-items: flex-start; gap: 1rem; margin-top: auto; }
}
[data-skin-part="panel"] { border: 3px solid var(--v-line); box-shadow: 6px 6px 0 var(--v-line); }
[data-skin-part="thanks-wall.card"] { border-width: 3px; border-style: solid; outline: 2px dashed var(--v-accent); outline-offset: 3px; }
""")
    g("add", "-A"); g("commit", "-q", "-m", f"e2e-duo {version}"); g("tag", "-f", f"e2e-duo-v{version}")

g("init", "-q", "-b", "main")
skin("1.0.0", "#a8231b", "#ff9a8b", "uppercase")
skin("1.1.0", "#0b5cad", "#8cc8ff", "none")
def index(version):
    return {"version": 1, "skins": [{"id": "e2e-duo", "name": {"fr": "Duo de test", "en": "Test duo"}, "description": {"fr": "Skin d'essai", "en": "Test skin"}, "repo": "https://github.com/e2e/curiosa-skins", "subdir": "skins/e2e-duo", "ref": f"e2e-duo-v{version}", "version": version, "skinContract": 1, "author": "Équipe de test", "tags": ["light", "dark"], "modes": ["light", "dark"], "requires": {"core": "0.3.0"}}]}
os.makedirs(os.path.join(OUT, "catalogue"), exist_ok=True)
json.dump(index("1.0.0"), open(os.path.join(OUT, "catalogue", "index.json"), "w"), indent=1)
g("add", "-A"); g("commit", "-q", "-m", "index 1.0.0")
open(os.path.join(OUT, "README.md"), "w").write("faux dépôt de skins\n"); g("add", "-A"); g("commit", "-q", "-m", "readme")
json.dump(index("1.1.0"), open(os.path.join(OUT, "catalogue", "index-1.1.0.json"), "w"), indent=1)  # copié sur index.json à l'étape « mise à jour »
# deux skins de plus, hors catalogue (dépôt personnel) : un lisible à un seul mode, un trop pâle
import json as _j
for fixture, sid, ver in (("plain-light", "calme-clair", "1.0.0"), ("faded-grey", "gris-pale", "1.0.0")):
    d = os.path.join(OUT, "skins", sid); shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(os.path.join("/dev/shm/s7/tests/fixtures/skins", fixture), d)
    m = _j.load(open(os.path.join(d, "skin.json"))); m["id"] = sid; m["minCore"] = "0.3.0"; m["version"] = ver
    m["name"] = {"fr": "Calme clair" if sid == "calme-clair" else "Gris pâle", "en": "Calm light" if sid == "calme-clair" else "Pale grey"}
    _j.dump(m, open(os.path.join(d, "skin.json"), "w"), indent=2, ensure_ascii=False)
    g("add", "-A"); g("commit", "-q", "-m", f"{sid} {ver}"); g("tag", "-f", f"{sid}-v{ver}")
print(g("tag"))

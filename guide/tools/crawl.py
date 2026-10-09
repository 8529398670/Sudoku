"""Re-download the guide's diagrams from sudokuwiki.org.

The images are git-ignored (personal-use licence), so a fresh checkout of the
guide has none. This crawls each technique page politely (one request every
~1.5s; robots.txt allows it), saves its diagrams into <guide>/<chapter>/images/
under the same names the chapters reference, and also writes a plain-text
copy of each page (with image markers) to TEXT_DIR for reference.

Usage, from the repo root:
    python3 -I guide/tools/crawl.py /tmp/sw-raw /tmp/sw-text guide
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://www.sudokuwiki.org/"
UA = "Mozilla/5.0 (personal study-guide crawler; 1 request / 1.5s)"

# (folder, slug, title, tier) -- ordered as a learning path.
PAGES = [
    ("00-foundations", "Getting_Started", "Getting Started", "Foundations"),
    ("00-foundations", "Introducing_Chains_and_Links", "Chains and Links", "Foundations"),
    ("00-foundations", "Weak_and_Strong_Links", "Weak and Strong Links", "Foundations"),
    ("01-naked-candidates", "Naked_Candidates", "Naked Pairs / Triples / Quads", "Basic"),
    ("02-hidden-candidates", "Hidden_Candidates", "Hidden Pairs / Triples / Quads", "Basic"),
    ("03-intersection-removal", "Intersection_Removal", "Pointing Pairs & Box/Line Reduction", "Basic"),
    ("04-x-wing", "X_Wing_Strategy", "X-Wing", "Tough"),
    ("05-chute-remote-pairs", "Chute_Remote_Pairs", "Chute Remote Pairs", "Tough"),
    ("06-simple-colouring", "Simple_Colouring", "Simple Colouring", "Tough"),
    ("07-y-wing", "Y_Wing_Strategy", "Y-Wing (XY-Wing)", "Tough"),
    ("08-rectangle-elimination", "Rectangle_Elimination", "Rectangle Elimination", "Tough"),
    ("09-swordfish", "Sword_Fish_Strategy", "Swordfish", "Tough"),
    ("10-xyz-wing", "XYZ_Wing", "XYZ-Wing", "Tough"),
    ("11-bug", "BUG", "BUG+1", "Tough"),
    ("12-avoidable-rectangles", "Avoidable_Rectangles", "Avoidable Rectangles", "Tough"),
    ("13-w-wing", "W_Wing_Strategy", "W-Wing", "Tough"),
    ("14-x-cycles", "X_Cycles", "X-Cycles (Part 1)", "Diabolical"),
    ("14-x-cycles", "X_Cycles_Part_2", "X-Cycles (Part 2)", "Diabolical"),
    ("15-3d-medusa", "3D_Medusa", "3D Medusa", "Diabolical"),
    ("16-jellyfish", "Jelly_Fish_Strategy", "Jellyfish", "Diabolical"),
    ("17-unique-rectangles", "Unique_Rectangles", "Unique Rectangles", "Diabolical"),
    ("18-tridagons", "Tridagons", "Tridagons", "Diabolical"),
    ("19-fireworks", "Fireworks", "Fireworks", "Diabolical"),
    ("20-twinned-xy-chains", "Twinned_XY_Chains", "Twinned XY-Chains", "Diabolical"),
    ("21-sk-loops", "SK_Loops", "SK Loops", "Diabolical"),
    ("22-extended-unique-rectangles", "Extended_Unique_Rectangles", "Extended Unique Rectangles", "Diabolical"),
    ("23-hidden-unique-rectangles", "Hidden_Unique_Rectangles", "Hidden Unique Rectangles", "Diabolical"),
    ("24-wxyz-wing", "WXYZ_Wing", "WXYZ-Wing", "Diabolical"),
    ("25-xy-chains", "XY_Chains", "XY-Chains", "Diabolical"),
    ("26-aligned-pair-exclusion", "Aligned_Pair_Exclusion", "Aligned Pair Exclusion", "Diabolical"),
    ("27-grouped-x-cycles", "Grouped_X_Cycles", "Grouped X-Cycles", "Diabolical"),
    ("28-forcing-nets", "Forcing_Nets", "Forcing Nets", "Diabolical"),
    ("29-finned-x-wing", "Finned_X_Wing", "Finned X-Wing", "Extreme"),
    ("30-finned-swordfish", "Finned_Swordfish", "Finned Swordfish", "Extreme"),
    ("31-franken-swordfish", "Franken_Sword_Fish", "Franken Swordfish", "Extreme"),
    ("32-alternating-inference-chains", "Alternating_Inference_Chains", "Alternating Inference Chains (AIC)", "Extreme"),
    ("33-aic-with-groups", "AIC_with_Groups", "AIC with Groups", "Extreme"),
    ("34-aic-with-als", "AIC_with_ALSs", "AIC with ALSs", "Extreme"),
    ("35-aic-with-unique-rectangles", "Using_Unique_Rectangles_as_Links_in_Chains", "AIC with Unique Rectangles", "Extreme"),
    ("36-aic-exotic-links", "AICs_with_Exotic_Links", "AIC with Exotic Links", "Extreme"),
    ("37-almost-locked-sets", "Almost_Locked_Sets", "Almost Locked Sets (ALS-XZ)", "Extreme"),
    ("38-almost-locked-pairs", "Almost_Locked_Pair", "Almost Locked Pairs / Triples", "Extreme"),
    ("39-death-blossom", "Death_Blossom", "Death Blossom", "Extreme"),
    ("40-sue-de-coq", "Sue_de_Coq", "Sue de Coq", "Extreme"),
    ("41-digit-forcing-chains", "Digit_Forcing_Chains", "Digit Forcing Chains", "Extreme"),
    ("42-nishio-forcing-chains", "Nishio_Forcing_Chains", "Nishio Forcing Chains", "Extreme"),
    ("43-cell-forcing-chains", "Cell_Forcing_Chains", "Cell Forcing Chains", "Extreme"),
    ("44-unit-forcing-chains", "Unit_Forcing_Chains", "Unit Forcing Chains", "Extreme"),
    ("45-exocet", "Exocet", "Exocet", "Extreme"),
    ("46-double-exocet", "Double_Exocet", "Double Exocet", "Extreme"),
    ("47-pattern-overlay", "Pattern_Overlay", "Pattern Overlay", "Extreme"),
    ("48-bowmans-bingo", "Bowmans_Bingo", "Bowman's Bingo", "Extreme"),
    ("49-remote-pairs", "Remote_Pairs", "Remote Pairs", "Other"),
    ("50-y-wing-chains", "Y_Wing_Chains", "Y-Wing Chains", "Other"),
    ("51-multi-colouring", "Multi_Colouring_Strategy", "Multi-Colouring", "Other"),
    ("52-empty-rectangles", "Empty_Rectangles", "Empty Rectangles", "Other"),
    ("53-multivalue-x-wing", "Multivalue_X_Wing_Strategy", "Multivalue X-Wing", "Other"),
    ("54-guardians", "Guardians", "Guardians", "Other"),
    ("55-gurths-theorem", "Gurths_Theorem", "Gurth's Symmetrical Placement", "Other"),
]

# Site chrome that is not part of any lesson.
SKIP_IMG = re.compile(r"(GRNARR|lanap\.aspx|SudokuWiki_Mid|Follow-on|favicon|/images/)", re.I)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def content_region(page):
    start = page.find('<div class="contentshell">')
    end = page.find('<a name="comments">', start)
    if end < 0:
        end = page.find("<h1>Comments</h1>", start)
    return page[start:end] if start >= 0 else ""


def to_text(region, imgmap):
    s = re.sub(r"<script.*?</script>", "", region, flags=re.S | re.I)
    s = re.sub(r"<style.*?</style>", "", s, flags=re.S | re.I)

    def img(m):
        src = html.unescape(m.group(1))
        alt = re.search(r'alt="([^"]*)"', m.group(0))
        local = imgmap.get(src)
        if not local:
            return ""
        return f"\n[[IMG {local} | {html.unescape(alt.group(1)) if alt else ''}]]\n"

    s = re.sub(r'<img[^>]*src="([^"]+)"[^>]*>', img, s, flags=re.I)

    def link(m):
        href = html.unescape(m.group(1))
        txt = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        if "bd=" in href:
            href = urllib.parse.urljoin(BASE, href)
            return f"[{txt}]({href})"
        return f"[{txt}](→{href})"

    s = re.sub(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', link, s, flags=re.S | re.I)
    s = re.sub(r"<h([1-4])[^>]*>(.*?)</h\1>", lambda m: "\n\n" + "#" * int(m.group(1)) + " " + m.group(2) + "\n", s, flags=re.S | re.I)
    s = re.sub(r"<li[^>]*>", "\n- ", s, flags=re.I)
    s = re.sub(r"<span class=\"hy\">(.*?)</span>", r"«\1»", s, flags=re.S)
    s = re.sub(r"<b>(.*?)</b>", r"**\1**", s, flags=re.S | re.I)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</(p|div|tr|figure|figcaption|table|ul|ol)>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n\s*\n\s*\n+", "\n\n", s)
    return s.strip()


def main():
    raw_dir, text_dir, guide_dir = sys.argv[1:4]
    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(text_dir, exist_ok=True)
    manifest = []
    for folder, slug, title, tier in PAGES:
        raw_path = os.path.join(raw_dir, slug + ".html")
        if not os.path.exists(raw_path):
            try:
                data = fetch(BASE + slug)
            except Exception as e:  # noqa: BLE001
                print(f"!! {slug}: {e}")
                manifest.append({"slug": slug, "error": str(e)})
                continue
            open(raw_path, "wb").write(data)
            time.sleep(1.5)
        page = open(raw_path, encoding="utf-8", errors="replace").read()
        region = content_region(page)
        srcs = []
        for m in re.finditer(r'<img[^>]*src="([^"]+)"', region, flags=re.I):
            src = html.unescape(m.group(1))
            if SKIP_IMG.search(src) or src in srcs:
                continue
            srcs.append(src)
        img_dir = os.path.join(guide_dir, folder, "images")
        imgmap = {}
        for src in srcs:
            url = urllib.parse.urljoin(BASE, src)
            name = os.path.basename(urllib.parse.urlparse(url).path)
            name = re.sub(r"[^A-Za-z0-9._-]", "_", name).rstrip("_")
            dest = os.path.join(img_dir, name)
            imgmap[src] = f"images/{name}"
            if os.path.exists(dest):
                continue
            os.makedirs(img_dir, exist_ok=True)
            try:
                open(dest, "wb").write(fetch(url))
            except Exception as e:  # noqa: BLE001
                print(f"!! img {url}: {e}")
                imgmap.pop(src)
            time.sleep(0.4)
        text = to_text(region, imgmap)
        open(os.path.join(text_dir, slug + ".txt"), "w").write(f"FOLDER: {folder}\n\n{text}\n")
        manifest.append({"folder": folder, "slug": slug, "title": title, "tier": tier,
                         "images": list(imgmap.values()), "chars": len(text)})
        print(f"{slug:50s} imgs={len(imgmap):3d} chars={len(text)}")
    json.dump(manifest, open(os.path.join(text_dir, "manifest.json"), "w"), indent=1)


main()

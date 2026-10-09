# The Sudoku Technique Guide

A hands-on tutorial for **every standard Sudoku solving technique**, from your first hidden single to Exocets and Forcing Nets. Each chapter has the same shape:

> **In one sentence** → **the intuition** (an analogy plus an ASCII sketch) → **how to spot it** (a checklist) → **worked examples** with diagrams → **common mistakes** → **how it connects** → **practice puzzles**

Every example comes with a **▶ Load position** link. It opens [sudokuwiki.org's solver](https://www.sudokuwiki.org/sudoku.htm) at exactly that moment, so you can click **Take Step** and watch it happen.

---

## Before you start

### Coordinates

Rows are **A–J** (there's no I), columns are **1–9**, and boxes are **1–9** in reading order. **E5** is the centre cell. Full details are in [Foundations](00-foundations/README.md).

### Reading the diagrams

All diagrams come from sudokuwiki.org's solver. They use these conventions:

| You see | It means |
|---|---|
| **green**-highlighted candidate | part of the pattern / the "ON" side |
| **yellow**-highlighted candidate | **eliminated** by the step |
| **orange / brown / yellow** cell shading | the cells that form the pattern |
| **solid** line between candidates | **strong** link (exactly two options) |
| **dashed** line | **weak** link (they can't both be true) |
| **green** circle / **red** circle | candidate switched **ON** / **OFF** in a chain |

### Reading chain notation

| Notation | Meaning |
|---|---|
| `+5[A3]` | 5 is **ON** in A3 |
| `-5[A3]` | 5 is **OFF** in A3 |
| `+4[D7\|D8\|D9]` | 4 is in **one of** these cells (a *group*) |
| `+7{H6\|G6}` | an **Almost Locked Set** locks 7 into these cells |
| `-9(UR[DF28])` | a link made by a **Unique Rectangle** |

---

## Learning path

Learn the tiers **in order**. Within a tier, ⭐ marks the techniques that pay off most often.

### 🟢 Start here

| # | Chapter | In a nutshell |
|---|---|---|
| 00 | [Foundations](00-foundations/README.md) ⭐ | Coordinates, singles, **strong vs weak links** |

### 🔵 Basic: solves most newspaper puzzles

| # | Technique | In a nutshell |
|---|---|---|
| 01 | [Naked Pairs / Triples / Quads](01-naked-candidates/README.md) ⭐ | N cells that hold only N digits between them |
| 02 | [Hidden Pairs / Triples / Quads](02-hidden-candidates/README.md) ⭐ | N digits that fit only in N cells |
| 03 | [Pointing Pairs & Box/Line Reduction](03-intersection-removal/README.md) ⭐ | A digit confined to a box–line overlap |

### 🟡 Tough

| # | Technique | In a nutshell |
|---|---|---|
| 04 | [X-Wing](04-x-wing/README.md) ⭐ | Two rows, the same two columns, one digit |
| 05 | [Chute Remote Pairs](05-chute-remote-pairs/README.md) | Two identical pairs in a band, checked against the third box |
| 06 | [Simple Colouring](06-simple-colouring/README.md) ⭐ | Two-colour a single digit's strong links |
| 07 | [Y-Wing (XY-Wing)](07-y-wing/README.md) ⭐ | A pivot with two pincers, one of which must be Z |
| 08 | [Rectangle Elimination](08-rectangle-elimination/README.md) ⭐ | "That would empty a box" |
| 09 | [Swordfish](09-swordfish/README.md) | An X-Wing with three lines |
| 10 | [XYZ-Wing](10-xyz-wing/README.md) | A Y-Wing whose pivot has three candidates |
| 11 | [BUG+1](11-bug/README.md) | All cells bivalue but one, so that cell's odd digit wins |
| 12 | [Avoidable Rectangles](12-avoidable-rectangles/README.md) | Uniqueness, using cells you solved yourself |
| 13 | [W-Wing](13-w-wing/README.md) ⭐ | Two identical pairs joined by a strong link |

### 🟠 Diabolical

| # | Technique | In a nutshell |
|---|---|---|
| 14 | [X-Cycles / Nice Loops](14-x-cycles/README.md) ⭐ | Alternating loops on one digit; the 3 rules |
| 15 | [3D Medusa](15-3d-medusa/README.md) ⭐ | Colouring across every digit |
| 16 | [Jellyfish](16-jellyfish/README.md) | A 4×4 fish |
| 17 | [Unique Rectangles](17-unique-rectangles/README.md) ⭐ | Types 1–5: avoid the deadly pattern |
| 18 | [Tridagons](18-tridagons/README.md) | An impossible 4-box pattern plus a guardian |
| 19 | [Fireworks](19-fireworks/README.md) | Row and column escapes form a locked set |
| 20 | [Twinned XY-Chains](20-twinned-xy-chains/README.md) | Six cells, six digits, two loops |
| 21 | [SK Loops](21-sk-loops/README.md) | Easter Monster's ring of hidden pairs |
| 22 | [Extended Unique Rectangles](22-extended-unique-rectangles/README.md) | Deadly pattern on three digits (2×3) |
| 23 | [Hidden Unique Rectangles](23-hidden-unique-rectangles/README.md) | Strong links stand in for clean corners |
| 24 | [WXYZ-Wing](24-wxyz-wing/README.md) | A bent quad with one non-restricted digit |
| 25 | [XY-Chains](25-xy-chains/README.md) ⭐ | A path of bivalue cells, same digit at both ends |
| 26 | [Aligned Pair Exclusion](26-aligned-pair-exclusion/README.md) | Try every pairing and cross out the killers |
| 27 | [Grouped X-Cycles](27-grouped-x-cycles/README.md) | X-Cycles that use box–line groups |
| 28 | [Forcing Nets](28-forcing-nets/README.md) | Follow every consequence until something breaks |

### 🔴 Extreme

| # | Technique | In a nutshell |
|---|---|---|
| 29 | [Finned X-Wing (+ Sashimi)](29-finned-x-wing/README.md) ⭐ | An almost-X-Wing with a fin in one box |
| 30 | [Finned Swordfish](30-finned-swordfish/README.md) | Same idea, three lines |
| 31 | [Franken Swordfish](31-franken-swordfish/README.md) | A fish with a box as one of its lines |
| 32 | [Alternating Inference Chains](32-alternating-inference-chains/README.md) ⭐ | **The** unifying chain technique |
| 33 | [AIC with Groups](33-aic-with-groups/README.md) | Chains through box–line groups |
| 34 | [AIC with ALSs](34-aic-with-als/README.md) | Chains through almost-locked sets |
| 35 | [AIC with Unique Rectangles](35-aic-with-unique-rectangles/README.md) | UR escape candidates as a strong link |
| 36 | [AIC with Exotic Links](36-aic-exotic-links/README.md) | A tiny branching "X-Wing link" |
| 37 | [Almost Locked Sets (ALS-XZ)](37-almost-locked-sets/README.md) ⭐ | Two ALSs plus a restricted common |
| 38 | [Almost Locked Pairs / Triples](38-almost-locked-pairs/README.md) | A virtual naked pair through a group |
| 39 | [Death Blossom](39-death-blossom/README.md) | A stem cell with one ALS petal per candidate |
| 40 | [Sue de Coq](40-sue-de-coq/README.md) | An intersection plus line and box helpers form a locked set |
| 41 | [Digit Forcing Chains](41-digit-forcing-chains/README.md) | ON and OFF both lead to the same result |
| 42 | [Nishio Forcing Chains](42-nishio-forcing-chains/README.md) | ON leads to a contradiction |
| 43 | [Cell Forcing Chains](43-cell-forcing-chains/README.md) | Every candidate of a cell agrees |
| 44 | [Unit Forcing Chains](44-unit-forcing-chains/README.md) | Every position of a digit in a unit agrees |
| 45 | [Exocet](45-exocet/README.md) | Base and target cells in a band |
| 46 | [Double Exocet](46-double-exocet/README.md) | Two Exocets that share a base set |
| 47 | [Pattern Overlay](47-pattern-overlay/README.md) | List every template for a digit |
| 48 | [Bowman's Bingo](48-bowmans-bingo/README.md) | One assumption solves the whole board |

### ⚪ Classic / retired techniques

These were folded into more general techniques but are still worth knowing, either because they're easy to see or because other guides use the names.

| # | Technique | Superseded by |
|---|---|---|
| 49 | [Remote Pairs](49-remote-pairs/README.md) | XY-Chains / Simple Colouring |
| 50 | [Y-Wing Chains](50-y-wing-chains/README.md) | XY-Chains |
| 51 | [Multi-Colouring](51-multi-colouring/README.md) | X-Cycles / AIC |
| 52 | [Empty Rectangles](52-empty-rectangles/README.md) | Rectangle Elimination |
| 53 | [Multivalue X-Wing](53-multivalue-x-wing/README.md) | AIC |
| 54 | [Guardians / Oddagons](54-guardians/README.md) | X-Cycles |
| 55 | [Gurth's Symmetrical Placement](55-gurths-theorem/README.md) | (special: symmetric puzzles only) |

---

## A practical solving routine

When you're stuck, run through this list **in order** and restart from the top after every success:

```
1. Singles            (scan digit by digit; then check cells with 1 candidate)
2. Intersections      (pointing / claiming)
3. Subsets            (naked & hidden pairs → triples)
4. Fish on one digit  (X-Wing → Swordfish; Rectangle Elimination; Simple Colouring)
5. Bivalue patterns   (Y-Wing, W-Wing, XYZ-Wing, Remote Pairs, BUG+1)
6. Uniqueness         (Unique Rectangle Type 1 → 2 → 4)
7. Chains             (XY-Chain → X-Cycle → AIC; add groups & ALSs as needed)
8. Heavy machinery    (Medusa, ALS-XZ, Finned fish, Forcing chains/nets)
```

> 💡 Most "impossible" puzzles from ordinary sources give way at step 5 or 6. If you find yourself at step 8 often, the puzzle source is aiming at experts.

## How this app's difficulty levels line up

The engine in [static/js/sudoku-engine.js](../static/js/sudoku-engine.js) grades each puzzle by the hardest technique it needs:

| Difficulty | Engine tier | Techniques | Guide chapters |
|---|---|---|---|
| Easy | 1 | hidden & naked singles | [00](00-foundations/README.md) |
| Medium | 2 | pointing, claiming, naked & hidden pairs | [01](01-naked-candidates/README.md), [02](02-hidden-candidates/README.md), [03](03-intersection-removal/README.md) |
| Hard | 3 | naked & hidden triples, X-Wing, XY-Wing | [01](01-naked-candidates/README.md), [02](02-hidden-candidates/README.md), [04](04-x-wing/README.md), [07](07-y-wing/README.md) |
| Expert | 4 | XYZ-Wing, Swordfish, Simple Colouring, Finned X-Wing, W-Wing, Unique Rectangle, quads, XY-Chain | [10](10-xyz-wing/README.md), [09](09-swordfish/README.md), [06](06-simple-colouring/README.md), [29](29-finned-x-wing/README.md), [13](13-w-wing/README.md), [17](17-unique-rectangles/README.md), [25](25-xy-chains/README.md) |

---

## Credits & licence

- **Diagrams, example positions and puzzle links** come from **[SudokuWiki.org](https://www.sudokuwiki.org/) by Andrew Stuart**, © Andrew Stuart / SyndicatedPuzzles. Individual techniques are credited at the top of each chapter, along with the people sudokuwiki credits for them.
- **Tutorial text** was written fresh for this guide. It explains the same well-known techniques in new words, with new structure, analogies and sketches.
- sudokuwiki's [copyright terms](https://www.sudokuwiki.org/Copyright) allow **personal use only**. Reproducing its content anywhere else needs the author's written consent. So the downloaded images in each `images/` folder are **git-ignored** (see [.gitignore](.gitignore)) and won't be pushed with the rest of the repo. If you publish this guide, you can publish the text, but **link to** the diagrams on sudokuwiki rather than re-hosting them, unless you get permission.

If something in a chapter doesn't match what you see in the solver, sudokuwiki's page is the source of truth. Every chapter links to it.

**Missing images after a fresh clone?** Re-download them for personal use (this takes about two minutes and is rate-limited to be polite to the site):

```bash
python3 -I guide/tools/crawl.py /tmp/sw-raw /tmp/sw-text guide
```

# OCR-B (Raisty) — provenance of the bundled font

This directory holds an **unmodified** copy of one font file and its license. The font is **not** covered by the project's own license
(BUSL-1.1); it stays under the SIL Open Font License 1.1 (`LICENSE-OFL.txt`). It is not renamed, subset, converted or edited.

| Item | Value |
|---|---|
| File | `OCR-B.ttf` (36,780 bytes, TrueType outlines, 1024 units per em) |
| sha256 | `367d876cca948ecd4900851f6e85687cbb6e71de9d0d2f36348edec5655526af` |
| Copy taken from | https://github.com/jaycee723/ocr-b at commit `fedeba81519770109925b5bec70e940be5948d8f` (committed 2020-07-11, "Initial OCR-B"), path `dist/OCR-B.ttf` |
| License text | `LICENSE-OFL.txt` is the repository's `LICENSE.md` of that commit, byte for byte (4,389 bytes): "Copyright (c) 2019, Raisty (https://github.com/raisty), with Reserved Font Name OCR-B." and the full SIL OFL 1.1 |
| Reserved Font Name | **OCR-B** (so a Modified Version of this font must not use that name; this project does not modify it) |
| Copyright holder | Raisty (https://github.com/raisty) |

## What the font file says about itself (`name` table, read from the file)

| nameID | Value |
|---|---|
| 0 Copyright | `Copyright © Raisty` |
| 1 Family | `OCR-B` |
| 2 Subfamily | `Regular` |
| 4 Full name | `OCR-B` |
| 5 Version | `1.1` |
| 6 PostScript name | `OCR-B` |
| 13 License description | `OFL` |
| 14 License URL | `https://scripts.sil.org/OFL` |

## Provenance and what could not be confirmed (checked 2026-10-01)

- The upstream repository named by the font's README (`raisty/OCR-B`, also served through the jsDelivr CDN as `gh/raisty/OCR-B`) **returns 404** and
  has no Wayback Machine snapshot; the author's GitHub account exists (created 2022-12-27) with no public repositories. **The copy above was
  obtained from a third party's re-upload** (not a fork), which is the only copy found.
- **Not confirmed — why the upstream was withdrawn.** The copyright notice and license of the copy could not be checked against the author's own
  publication.
- **Not confirmed — the origin of the outlines.** The README says the face was "originally developed in 1968 by Adrian Frutiger" and that this
  distribution "brings many improvements"; whether the outlines were drawn independently or derived from another OCR-B font could not be checked.
- Other OCR-B fonts found were not used: GPL-3.0 (`bcssupp0rt/ocrbfont`), an MIT variant altered for another project (`KurtisStirling/OCR-Bitcoin`),
  the CTAN Metafont package (`other-free`), and the commercial / Adobe Fonts OCR B Std.

## How this project uses it

Only the outlines of the digits 0-9 are read at run time (`src/barcode/ttf.ts`, a small TrueType reader without dependencies) and drawn as filled
paths for the human-readable numerals of a barcode. The file is read, never rewritten. A test pins its sha256: if the file changes, the test fails.

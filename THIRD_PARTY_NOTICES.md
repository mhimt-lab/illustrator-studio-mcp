# Third-party notices

This package contains the following third-party software. Its notice and permission text are reproduced as the licence requires.

## QR Code generator library (TypeScript)

Compiled into `dist/vendor/qrcodegen.js` (source `src/vendor/qrcodegen.ts`) and used to build the module matrix of a QR Code symbol.

- Project: Project Nayuki, QR Code generator library, <https://www.nayuki.io/page/qr-code-generator-library>
- Source: <https://github.com/nayuki/QR-Code-generator>, file `typescript-javascript/qrcodegen.ts`, commit `3c6d0b3cefb4e049dc337e82237c9644399716a8`
- Licence: MIT. The vendored file keeps the original copyright line and permission text unchanged.
- Changes to the upstream file: two lines only, a first line `// @ts-nocheck` (the upstream source does not pass this project's strict compiler settings) and a last line `export default qrcodegen;` (the upstream file declares a global namespace and has no export). SHA-256 of the upstream file: `1dc03fb5a10e0e2318ea162755bbdb9977ca6ce52cff959e9c9b6deafdccda9c`.

```
Copyright (c) Project Nayuki. (MIT License)
https://www.nayuki.io/page/qr-code-generator-library

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:
- The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.
- The Software is provided "as is", without warranty of any kind, express or
  implied, including but not limited to the warranties of merchantability,
  fitness for a particular purpose and noninfringement. In no event shall the
  authors or copyright holders be liable for any claim, damages or other
  liability, whether in an action of contract, tort or otherwise, arising from,
  out of or in connection with the Software or the use or other dealings in the
  Software.
```

## OCR-B font (bundled, unmodified)

`assets/fonts/ocr-b/OCR-B.ttf` (Raisty) is bundled unmodified for the numerals of `illustrator_create_barcode` and stays under the SIL Open Font License 1.1. Its licence text is `assets/fonts/ocr-b/LICENSE-OFL.txt`, its provenance `assets/fonts/ocr-b/SOURCE.md`, and the project's note is in `docs/licensing.md`.

## Trademark

QR Code is a registered trademark of DENSO WAVE INCORPORATED. QRコードは株式会社デンソーウェーブの登録商標です。

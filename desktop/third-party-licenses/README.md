# Third-party licenses in the Windows installer

The installer includes these notices in `resources/licenses`. The original
Unreal Agent MIT license is at `resources/backend/LICENSE`. Electron's license
and Chromium's component notices are at the application root as
`LICENSE.electron.txt` and `LICENSES.chromium.html`.

- `NPM_NOTICES.txt` contains the license text for every production dependency
  listed in `desktop/package-lock.json`. The build regenerates it from the
  installed packages and stops if a license is missing or outside the reviewed
  MIT, ISC, 0BSD, BSD-2-Clause and BSD-3-Clause set, plus the specifically reviewed
  PDF.js/Tesseract.js and their Apache-2.0 dependencies, Playwright Core,
  DOMPurify Apache-2.0 alternative, argparse 2.0.1 Python-2.0 license and sax 1.6.1
  BlueOak-1.0.0 license. Their notices are included.
  `lazy-val` 1.0.5 declares MIT in its upstream package metadata but omits a license
  file; `lazy-val-NOTICE.txt` preserves its declared author and standard MIT terms,
  explicitly identifying that provenance. `node-pty` includes a separate winpty MIT license in
  its bundled `deps/winpty/LICENSE`. The platform-specific
  `@napi-rs/canvas-win32-x64-msvc` 1.0.9 package declares MIT but omits a license
  file; its parent package MIT text is reproduced in generated notices.
  `tr46` 0.0.3 likewise declares MIT and omits the file; `tr46-NOTICE.txt`
  identifies the package metadata and reproduces the terms.
- `jev-browser-LICENSE.txt` covers the MIT-licensed 0.1.1 source adapted from
  pinned commit `e35ab134f65033d29c528132d92bf06e8d6adcb5` in
  `src/main/jev-browser-adapter.ts`. UnrealCode replaced its Playwright launcher
  and environment-key client with the shared Electron tab driver and existing
  decision broker.
- `tessdata-fast-LICENSE.txt` covers English and Arabic OCR weights downloaded
  on demand from pinned commit `65727574dfcd264acbb0c3e07860e4e9e9b22185`.
  Downloads are SHA-256 verified before use. `skia-LICENSE.txt` covers the Skia
  code included in the native canvas dependency used for PDF page OCR.
- `go/` contains the license texts for the Go toolchain and the five modules
  in `go.mod`, copied from the exact versions used to build the backend.
- `openai-openapi-LICENSE.txt` covers the OpenAI OpenAPI definition used to
  generate the included client code.
- `microsoft-terminal-LICENSE.txt` and `microsoft-terminal-NOTICE.md` cover
  the ConPTY/OpenConsole components shipped by `node-pty` on Windows.

Docker Desktop, the Codex CLI, Ollama, Laya, GLiNER, and model weights are not
bundled with the Windows installer. The backend Docker image is built locally
from bundled source after installation; Debian package notices remain in that
image under `/usr/share/doc`.

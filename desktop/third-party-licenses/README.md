# Third-party licenses in the Windows installer

The installer includes these notices in `resources/licenses`. The original
Unreal Agent MIT license is at `resources/backend/LICENSE`. Electron's license
and Chromium's component notices are at the application root as
`LICENSE.electron.txt` and `LICENSES.chromium.html`.

- `NPM_NOTICES.txt` contains the license text for every production dependency
  listed in `desktop/package-lock.json`. The build regenerates it from the
  installed packages and stops if a license is missing or outside the reviewed
  MIT, ISC, and 0BSD set. `node-pty` includes a separate winpty MIT license in
  its bundled `deps/winpty/LICENSE`.
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

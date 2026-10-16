Run: `npm install && npm start`

Build dist: `npm run dist`

## Build the VS Code extension

The IDE extension lives in `extension/`. To build the installable package:

```bash
cd extension
npx --yes @vscode/vsce package --no-dependencies
```

This creates `extension/stride-tasks-<version>.vsix` (the version comes from `extension/package.json`).

Install it in VS Code with **Extensions → "…" menu → Install from VSIX…**, or from a terminal:

```bash
code --install-extension extension/stride-tasks-<version>.vsix
```

Reload the VS Code window afterwards. The extension follows the app's theme colour, so open the Stride app once so it writes `~/.stride/theme.json`.

# 365 Copilot Code

A VS Code extension that connects to Microsoft 365 Copilot to help with coding tasks.

> Status: early scaffold. The Microsoft 365 Copilot integration is not implemented yet; the extension currently registers a placeholder **365 Copilot Code: Hello World** command.

## Requirements

- VS Code 1.95 or later
- Node.js 22 or later

## Development

```bash
npm install
npm run compile   # build once
npm run watch     # rebuild on change
npm run lint      # ESLint
npm test          # compile, lint, then run tests in a VS Code instance
npm run package   # build a .vsix with @vscode/vsce
```

To try the extension, open this folder in VS Code and press `F5`. This launches an Extension Development Host; run **365 Copilot Code: Hello World** from the Command Palette.

On Linux without a display, run tests with `xvfb-run -a npm test`.

## Installing a build

Every CI run uploads the packaged extension as the `365-copilot-code-vsix` artifact. Download it from the run's summary page on the Actions tab, unzip it, then install the `.vsix` with **Extensions: Install from VSIX...** in VS Code or `code --install-extension <file>.vsix`.

## Project layout

- `src/extension.ts` is the extension entry point (`activate` / `deactivate`).
- `src/test/` holds the Mocha tests run by `@vscode/test-cli`.
- `.vscode/` has the launch and build task configuration for debugging.

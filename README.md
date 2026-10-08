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
```

To try the extension, open this folder in VS Code and press `F5`. This launches an Extension Development Host; run **365 Copilot Code: Hello World** from the Command Palette.

On Linux without a display, run tests with `xvfb-run -a npm test`.

## Project layout

- `src/extension.ts` is the extension entry point (`activate` / `deactivate`).
- `src/test/` holds the Mocha tests run by `@vscode/test-cli`.
- `.vscode/` has the launch and build task configuration for debugging.

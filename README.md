# 365 Copilot Code

A VS Code extension that connects to Microsoft 365 Copilot to help with coding tasks.

> Status: early. Signing in to Microsoft 365 is implemented; chat with Copilot is not yet.

## Signing in

The extension signs in with VS Code's built-in Microsoft account provider and requests the delegated Microsoft Graph permissions the [Microsoft 365 Copilot Chat API](https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/copilotroot-post-conversations) needs: `Sites.Read.All`, `Mail.Read`, `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `Chat.Read`, `ChannelMessage.Read.All` and `ExternalItem.Read.All`. You need a work or school account with a Microsoft 365 Copilot license; personal Microsoft accounts are not supported by the API.

- Click **M365 Copilot: Sign in** in the status bar, or run **365 Copilot Code: Sign In to Microsoft 365 Copilot**.
- Once signed in, the status bar shows your account. Click it, or run **Sign Out of Microsoft 365 Copilot**, to stop the extension using that account. The account stays signed in to VS Code until you remove it from the Accounts menu.

Several of these permissions need admin consent. If sign-in fails with a consent or "app not approved" error, ask your tenant admin to register an app for the extension and set:

- `365CopilotCode.auth.clientId`: the app registration's Application (client) ID.
- `365CopilotCode.auth.tenantId`: your tenant ID or domain, such as `contoso.onmicrosoft.com`.

The app registration needs a **Mobile and desktop applications** platform with the redirect URIs `http://localhost` and `https://vscode.dev/redirect`, the delegated Graph permissions above, and admin consent granted.

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

The easiest way to get the extension is the `.vsix` attached to the latest [GitHub release](https://github.com/Unicodist/365CopilotCode/releases/latest). Install it with **Extensions: Install from VSIX...** in VS Code or `code --install-extension <file>.vsix`.

To get a build of a branch or pull request instead, use its CI run. Every CI run uploads the packaged extension as the `365-copilot-code-vsix` artifact. Download it from the run's summary page on the Actions tab, unzip it, then install the `.vsix` with **Extensions: Install from VSIX...** in VS Code or `code --install-extension <file>.vsix`.

## Releasing

Bump `version` in `package.json` (for example with `npm version patch`), push the commit, then push a matching tag such as `v0.0.2`. The Release workflow checks that the tag matches the version, runs the tests, packages the extension and creates a GitHub release with the `.vsix` attached. Tags with a suffix, such as `v0.1.0-beta.1`, are published as pre-releases.

## Project layout

- `src/extension.ts` is the extension entry point (`activate` / `deactivate`).
- `src/auth.ts` handles Microsoft 365 sign-in and hands out Graph access tokens (`AuthManager.getAccessToken`).
- `src/statusBar.ts` shows the signed-in account in the status bar.
- `src/test/` holds the Mocha tests run by `@vscode/test-cli`.
- `.vscode/` has the launch and build task configuration for debugging.

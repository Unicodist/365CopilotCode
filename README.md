# 365 Copilot Code

A VS Code extension that connects to Microsoft 365 Copilot to help with coding tasks.

> Status: early. You can sign in and ask Microsoft 365 Copilot questions about your code, with your open file and related workspace files sent as context.

## Getting started

1. **Check you can use it.** You need VS Code 1.95 or later and a Microsoft 365 work or school account with a Microsoft 365 Copilot license. Personal Microsoft accounts are not supported.
2. **Install the extension.** It is not on the Marketplace yet, so install a CI build:
   - Open the [Actions tab](https://github.com/Unicodist/365CopilotCode/actions/workflows/ci.yml), pick the latest green run on `main`, and download the `365-copilot-code-vsix` artifact from the run's summary page.
   - Unzip it to get the `.vsix` file.
   - In VS Code, run **Extensions: Install from VSIX...** from the Command Palette and pick the file, or run `code --install-extension 365-copilot-code-<sha>.vsix`.
3. **Sign in.** Click **M365 Copilot: Sign in** in the status bar, or run **365 Copilot Code: Sign In to Microsoft 365 Copilot**, and choose your work account in the browser window that opens. The status bar then shows your account.
4. **If sign-in is blocked by your organization** (a consent or "app not approved" error), ask your tenant admin to register an app for the extension, then set `365CopilotCode.auth.clientId` and `365CopilotCode.auth.tenantId` in Settings. See [Signing in](#signing-in) for what the admin needs to set up.
5. **Ask Copilot about your code.** Either:
   - In the Chat view, type `@m365` followed by your question, for example `@m365 why does this function return undefined?`. Attach more files with `#file` or by dragging them into the chat. Follow-up questions in the same chat continue the same Copilot conversation.
   - Or run **365 Copilot Code: Ask Microsoft 365 Copilot...** from the Command Palette or the editor's right-click menu. The answer opens in a panel beside your code, with the list of files that were sent.

   The Chat view needs a VS Code build with chat (it ships with VS Code); the command works everywhere.

To stop using your account, click the account in the status bar or run **365 Copilot Code: Sign Out of Microsoft 365 Copilot**.

### Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `365CopilotCode.auth.clientId` | empty | Application (client) ID of your own Microsoft Entra app registration. Leave empty to use VS Code's built-in Microsoft sign-in. |
| `365CopilotCode.auth.tenantId` | empty | Tenant ID or domain, such as `contoso.onmicrosoft.com`. Leave empty to sign in with any work or school account. |
| `365CopilotCode.context.maxCharacters` | `40000` | Most characters of file content sent with one question. |
| `365CopilotCode.context.includeWorkspaceFiles` | `true` | Also send open tabs and workspace files related to the question. Turn off to send only the active file, selection and attached files. |
| `365CopilotCode.context.maxWorkspaceFiles` | `5` | Most open tabs and related workspace files sent with one question. |
| `365CopilotCode.context.exclude` | `[]` | Extra glob patterns for files never sent, such as `["**/fixtures/**"]`. |

### Commands

| Command | What it does |
| --- | --- |
| **365 Copilot Code: Sign In to Microsoft 365 Copilot** | Signs in with your Microsoft 365 account. |
| **365 Copilot Code: Sign Out of Microsoft 365 Copilot** | Stops the extension using your account. |
| **365 Copilot Code: Ask Microsoft 365 Copilot...** | Asks Copilot a question with your active file and related workspace files as context. |

### What gets sent to Copilot

Each question is sent to the [Microsoft 365 Copilot Chat API](https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/overview) with file contents as additional context, in this order until `365CopilotCode.context.maxCharacters` is used up:

1. The code you have selected, if any.
2. Files you attached in chat with `#file`.
3. The whole active file, including unsaved changes.
4. Other files open in editor tabs.
5. Workspace files the active file imports, and files whose names match words in your question.

Steps 4 and 5 add at most `365CopilotCode.context.maxWorkspaceFiles` files. Files matched by `.gitignore`, `files.exclude` or `365CopilotCode.context.exclude`, build output and `node_modules`, binary files, and files that commonly hold secrets (`.env`, private keys, `.npmrc`, `credentials`) are never picked automatically; a file you attach yourself is always sent. The chat response lists the files that were used.

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

Create a branch named `release/<something>` from `main` (for example `release/0.1`), set `version` in `package.json` to the version you want to ship, and push the branch. The Release workflow runs the tests, packages the extension and creates a GitHub release tagged `v<version>` with the `.vsix` attached. Versions with a suffix, such as `0.1.0-beta.1`, are published as pre-releases.

Every push to a release branch builds the `.vsix` and uploads it as a workflow artifact. A new release is published only when the version in `package.json` hasn't been released yet, so bump the version on the branch to ship a fix.

## Project layout

- `src/extension.ts` is the extension entry point (`activate` / `deactivate`).
- `src/auth.ts` handles Microsoft 365 sign-in and hands out Graph access tokens (`AuthManager.getAccessToken`).
- `src/statusBar.ts` shows the signed-in account in the status bar.
- `src/context.ts` picks the editor and workspace files sent as context and fits them to the size budget.
- `src/copilot.ts` calls the Microsoft 365 Copilot Chat API.
- `src/chat.ts` registers the `@m365` chat participant and the **Ask Microsoft 365 Copilot...** command.
- `test-fixtures/workspace/` is the workspace the tests open.
- `src/test/` holds the Mocha tests run by `@vscode/test-cli`.
- `.vscode/` has the launch and build task configuration for debugging.

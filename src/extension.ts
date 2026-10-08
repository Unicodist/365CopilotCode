import * as vscode from "vscode";
import { AuthManager } from "./auth";
import { AuthStatusBar } from "./statusBar";

/** API returned from `activate`, for other parts of the extension and for tests. */
export interface ExtensionApi {
  auth: AuthManager;
  statusBar: AuthStatusBar;
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi> {
  const auth = new AuthManager(context.globalState);
  const statusBar = new AuthStatusBar(auth);

  const helloWorld = vscode.commands.registerCommand("365CopilotCode.helloWorld", () => {
    vscode.window.showInformationMessage("Hello from 365 Copilot Code!");
  });

  const signIn = vscode.commands.registerCommand("365CopilotCode.signIn", async () => {
    try {
      const session = await auth.signIn();
      vscode.window.showInformationMessage(`Signed in to Microsoft 365 Copilot as ${session.account.label}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Microsoft 365 sign-in failed: ${message}`);
    }
  });

  const signOut = vscode.commands.registerCommand("365CopilotCode.signOut", async () => {
    const label = auth.currentSession?.account.label;
    await auth.signOut();
    const manage = "Manage Accounts";
    const choice = await vscode.window.showInformationMessage(
      label
        ? `Signed out of Microsoft 365 Copilot. ${label} stays signed in to VS Code; remove it from the Accounts menu to sign out everywhere.`
        : "Signed out of Microsoft 365 Copilot.",
      manage,
    );
    if (choice === manage) {
      await vscode.commands.executeCommand("workbench.action.accounts");
    }
  });

  context.subscriptions.push(auth, statusBar, helloWorld, signIn, signOut);

  await auth.refresh();
  return { auth, statusBar };
}

export function deactivate() {}

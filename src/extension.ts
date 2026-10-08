import * as vscode from "vscode";
import { AuthManager, showSignInError } from "./auth";
import { registerAskCommand, registerChatParticipant } from "./chat";
import { CopilotClient } from "./copilot";
import { AuthStatusBar } from "./statusBar";

/** API returned from `activate`, for other parts of the extension and for tests. */
export interface ExtensionApi {
  auth: AuthManager;
  statusBar: AuthStatusBar;
  copilot: CopilotClient;
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi> {
  const auth = new AuthManager(context.globalState, context.secrets);
  const statusBar = new AuthStatusBar(auth);

  const helloWorld = vscode.commands.registerCommand("365CopilotCode.helloWorld", () => {
    vscode.window.showInformationMessage("Hello from 365 Copilot Code!");
  });

  const signIn = vscode.commands.registerCommand("365CopilotCode.signIn", async () => {
    try {
      const account = await auth.signIn();
      vscode.window.showInformationMessage(`Signed in to Microsoft 365 Copilot as ${account.label}.`);
    } catch (err) {
      await showSignInError(err);
    }
  });

  const signOut = vscode.commands.registerCommand("365CopilotCode.signOut", async () => {
    await auth.signOut();
    vscode.window.showInformationMessage("Signed out of Microsoft 365 Copilot.");
  });

  const copilot = new CopilotClient(() => auth.getAccessToken());
  const askCommand = registerAskCommand(copilot);
  const participant = registerChatParticipant(copilot);

  context.subscriptions.push(auth, statusBar, helloWorld, signIn, signOut, askCommand);
  if (participant) {
    context.subscriptions.push(participant);
  }

  await auth.refresh();
  return { auth, statusBar, copilot };
}

export function deactivate() {}


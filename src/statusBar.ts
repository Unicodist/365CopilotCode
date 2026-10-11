import * as vscode from "vscode";
import { AuthManager, type SignedInAccount } from "./auth";

/** Shows the Microsoft 365 sign-in state and opens sign-in or sign-out when clicked. */
export class AuthStatusBar implements vscode.Disposable {
  readonly item: vscode.StatusBarItem;
  private readonly subscription: vscode.Disposable;

  constructor(auth: AuthManager) {
    this.item = vscode.window.createStatusBarItem("365CopilotCode.auth", vscode.StatusBarAlignment.Right, 100);
    this.item.name = "365 Copilot Code Account";
    this.subscription = auth.onDidChangeAccount((account) => this.render(account));
    this.render(auth.currentAccount);
    this.item.show();
  }

  private render(account: SignedInAccount | undefined) {
    if (account) {
      this.item.text = `$(copilot) ${account.label}`;
      this.item.tooltip = `Signed in to Microsoft 365 Copilot as ${account.label}. Click to sign out.`;
      this.item.command = "365CopilotCode.signOut";
    } else {
      this.item.text = "$(sign-in) M365 Copilot: Sign in";
      this.item.tooltip = "Sign in to Microsoft 365 Copilot with your work or school account.";
      this.item.command = "365CopilotCode.signIn";
    }
  }

  dispose() {
    this.subscription.dispose();
    this.item.dispose();
  }
}

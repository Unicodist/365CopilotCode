import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const helloWorld = vscode.commands.registerCommand("365CopilotCode.helloWorld", () => {
    vscode.window.showInformationMessage("Hello from 365 Copilot Code!");
  });

  context.subscriptions.push(helloWorld);
}

export function deactivate() {}

import * as assert from "assert";
import * as vscode from "vscode";
import type { ExtensionApi } from "../extension";

suite("Extension", () => {
  test("registers its commands", async () => {
    const extension = vscode.extensions.getExtension<ExtensionApi>("unicodist.365-copilot-code");
    assert.ok(extension, "extension should be installed");
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    for (const id of ["365CopilotCode.helloWorld", "365CopilotCode.signIn", "365CopilotCode.signOut", "365CopilotCode.ask"]) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  });

  test("shows a sign-in status bar item when no account is signed in", async () => {
    const extension = vscode.extensions.getExtension<ExtensionApi>("unicodist.365-copilot-code");
    assert.ok(extension);
    const api = await extension.activate();

    assert.strictEqual(api.auth.currentAccount, undefined);
    assert.strictEqual(api.statusBar.item.command, "365CopilotCode.signIn");
    assert.match(api.statusBar.item.text, /Sign in/);
  });

  test("signing out leaves the extension signed out", async () => {
    const extension = vscode.extensions.getExtension<ExtensionApi>("unicodist.365-copilot-code");
    assert.ok(extension);
    const api = await extension.activate();

    await api.auth.signOut();
    assert.strictEqual(await api.auth.refresh(), undefined);
    assert.strictEqual(api.statusBar.item.command, "365CopilotCode.signIn");
  });
});

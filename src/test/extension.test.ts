import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension", () => {
  test("registers the Hello World command", async () => {
    const extension = vscode.extensions.getExtension("unicodist.365-copilot-code");
    assert.ok(extension, "extension should be installed");
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("365CopilotCode.helloWorld"));
  });
});

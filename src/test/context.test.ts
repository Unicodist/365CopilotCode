import * as assert from "assert";
import * as vscode from "vscode";
import { formatContextFile, gatherContext, isSensitivePath, packContext, questionKeywords, rankRelatedFiles, relativeImports, type ContextFile, type ContextSettings } from "../context";

function file(label: string, content: string, reason: ContextFile["reason"] = "related"): ContextFile {
  return { uri: vscode.Uri.file(`/ws/${label}`), label, languageId: "typescript", content, reason };
}

suite("context helpers", () => {
  test("flags files that commonly hold secrets", () => {
    for (const p of [".env", "app/.env.local", "certs/server.pem", "id_rsa", "deploy/key.pfx", ".npmrc"]) {
      assert.ok(isSensitivePath(p), p);
    }
    for (const p of ["src/env.ts", "README.md", "src/keyboard.ts"]) {
      assert.ok(!isSensitivePath(p), p);
    }
  });

  test("extracts keywords, splitting camelCase and dropping stop words", () => {
    const words = questionKeywords("Why does AuthManager fail in the status bar?");
    assert.ok(words.includes("authmanager"));
    assert.ok(words.includes("auth"));
    assert.ok(words.includes("manager"));
    assert.ok(words.includes("status"));
    assert.ok(!words.includes("does"));
    assert.ok(!words.includes("the"));
  });

  test("finds relative imports", () => {
    const src = `import { a } from "./a";\nimport "../b/c";\nconst d = require('./d');\nimport x from "vscode";`;
    assert.deepStrictEqual(relativeImports(src).sort(), ["../b/c", "./a", "./d"]);
  });

  test("ranks imported files and name matches first", () => {
    const ranked = rankRelatedFiles("how is billing calculated", ["src/app.ts", "src/util.ts", "src/billing.ts", "docs/billing.md", "src/other.ts"], {
      path: "src/app.ts",
      content: `import { x } from "./util";`,
    });
    assert.deepStrictEqual(ranked.slice(0, 3).sort(), ["docs/billing.md", "src/billing.ts", "src/util.ts"]);
    assert.ok(!ranked.includes("src/app.ts"), "the active file is not a related file");
    assert.ok(!ranked.includes("src/other.ts"));
  });

  test("packs files in order, truncating the one that overflows", () => {
    const packed = packContext([file("a.ts", "a".repeat(600)), file("b.ts", "line\n".repeat(300)), file("c.ts", "c".repeat(100))], 1200);
    assert.deepStrictEqual(packed.files.map((f) => f.label), ["a.ts", "b.ts"]);
    assert.ok(packed.files[1].truncated);
    assert.ok(packed.files[1].content.length <= 600);
    assert.ok(packed.files[1].content.endsWith("\n"), "cut at a line break");
    assert.deepStrictEqual(packed.omitted, ["c.ts"]);
  });

  test("formats a file as a fenced block with its path and lines", () => {
    const text = formatContextFile({ ...file("src/a.ts", "const a = 1;", "selection"), lines: { start: 3, end: 3 } });
    assert.strictEqual(text, "File: src/a.ts (lines 3-3)\n```typescript\nconst a = 1;\n```");
  });
});

suite("gatherContext", () => {
  const settings: ContextSettings = { maxCharacters: 40000, includeWorkspaceFiles: true, maxWorkspaceFiles: 5, exclude: [] };
  const root = () => vscode.workspace.workspaceFolders![0].uri;

  suiteSetup(async () => {
    assert.ok(vscode.workspace.workspaceFolders?.length, "tests run in the fixture workspace");
  });

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("sends the active file, its imports and matching files, skipping ignored and secret files", async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root(), "src/app.ts"));
    await vscode.window.showTextDocument(doc);

    const files = await gatherContext("how is billing calculated?", {}, settings);
    const labels = files.map((f) => `${f.reason}:${f.label}`);

    assert.strictEqual(labels[0], "active:src/app.ts");
    assert.ok(labels.includes("related:src/util.ts"), labels.join(", "));
    assert.ok(labels.includes("related:src/billing.ts"), labels.join(", "));
    assert.ok(!labels.some((l) => l.includes("generated/")), ".gitignore is respected");
    assert.ok(!labels.some((l) => l.includes(".env")), "secret files are skipped");
  });

  test("puts the selection first", async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root(), "src/util.ts"));
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(1, 0, 1, 10);

    const files = await gatherContext("explain this", {}, { ...settings, includeWorkspaceFiles: false });
    assert.deepStrictEqual(files.map((f) => f.reason), ["selection", "active"]);
    assert.deepStrictEqual(files[0].lines, { start: 2, end: 2 });
    assert.strictEqual(files[0].content, "  return `");
  });

  test("includes files the user attached, even ignored ones", async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    const attached = vscode.Uri.joinPath(root(), "generated/billing.ts");
    const files = await gatherContext("what is this", { references: [attached] }, { ...settings, includeWorkspaceFiles: false });
    assert.deepStrictEqual(files.map((f) => `${f.reason}:${f.label}`), ["reference:generated/billing.ts"]);
  });

  test("honours the extension's exclude setting", async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root(), "src/app.ts"));
    await vscode.window.showTextDocument(doc);
    const files = await gatherContext("billing", {}, { ...settings, exclude: ["**/billing.*"] });
    assert.ok(!files.some((f) => f.label.includes("billing")), files.map((f) => f.label).join(", "));
  });
});

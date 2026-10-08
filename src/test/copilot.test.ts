import * as assert from "assert";
import { buildChatBody, CopilotApiError, CopilotClient, COPILOT_API_BASE, extractReply } from "../copilot";
import { buildPrompt, escapeHtml, toCopilotContext } from "../chat";
import * as vscode from "vscode";

suite("Copilot client", () => {
  test("builds a chat body with file context", () => {
    const body = buildChatBody("hi", [{ text: "File: a.ts", description: "d" }], "Europe/London");
    assert.deepStrictEqual(body, {
      message: { text: "hi" },
      locationHint: { timeZone: "Europe/London" },
      additionalContext: [{ text: "File: a.ts", description: "d" }],
    });
    assert.ok(!("additionalContext" in buildChatBody("hi", [], "UTC")));
  });

  test("reads Copilot's reply rather than the echoed prompt", () => {
    assert.strictEqual(extractReply({ messages: [{ text: "q" }, { text: "answer" }] }, "q"), "answer");
    assert.throws(() => extractReply({ messages: [{ text: "q" }] }, "q"), CopilotApiError);
  });

  test("creates a conversation and sends the question with context", async () => {
    const calls: { url: string; body: unknown; auth: string }[] = [];
    const client = new CopilotClient(
      async () => "token-123",
      async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
        const payload = url.endsWith("/conversations") ? { id: "conv/1" } : { messages: [{ text: "q" }, { text: "It adds them." }] };
        return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
      },
    );
    const id = await client.createConversation();
    const reply = await client.chat(id, "q", [{ text: "ctx" }]);

    assert.strictEqual(reply, "It adds them.");
    assert.strictEqual(calls[0].url, `${COPILOT_API_BASE}/conversations`);
    assert.strictEqual(calls[1].url, `${COPILOT_API_BASE}/conversations/conv%2F1/chat`);
    assert.strictEqual(calls[1].auth, "Bearer token-123");
    assert.deepStrictEqual((calls[1].body as { additionalContext: unknown }).additionalContext, [{ text: "ctx" }]);
  });

  test("turns Graph errors into readable messages", async () => {
    const client = new CopilotClient(
      async () => "t",
      async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ error: { code: "Forbidden", message: "No license" } }) }),
    );
    await assert.rejects(client.createConversation(), (err: CopilotApiError) => {
      assert.strictEqual(err.status, 403);
      assert.match(err.message, /403 Forbidden\): No license/);
      assert.match(err.message, /license/);
      return true;
    });
  });
});

suite("chat prompt", () => {
  test("names the attached files in the prompt", () => {
    const files = [
      { uri: vscode.Uri.file("/a"), label: "src/a.ts", languageId: "typescript", content: "x", reason: "active" as const },
      { uri: vscode.Uri.file("/b"), label: "src/b.ts", languageId: "typescript", content: "y", reason: "related" as const },
    ];
    assert.match(buildPrompt("why?", files), /\(src\/a\.ts, src\/b\.ts\) to answer:\n\nwhy\?$/);
    assert.strictEqual(buildPrompt("why?", []), "why?");
    assert.strictEqual(toCopilotContext(files)[0].description, "File open in the user's editor: src/a.ts");
  });

  test("escapes HTML in the answer panel title", () => {
    assert.strictEqual(escapeHtml(`<b a="1">&'`), "&lt;b a=&quot;1&quot;&gt;&amp;&#39;");
  });
});

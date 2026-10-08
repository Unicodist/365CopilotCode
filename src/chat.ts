import * as vscode from "vscode";
import { CopilotClient, type CopilotContext } from "./copilot";
import { describeReason, formatContextFile, gatherContext, packContext, readContextSettings, type ContextFile, type PackedContext } from "./context";

export const PARTICIPANT_ID = "365CopilotCode.m365";

/** Text sent ahead of the user's question so Copilot treats the attached files as code context. */
export function buildPrompt(question: string, files: readonly ContextFile[]): string {
  if (files.length === 0) {
    return question;
  }
  const names = files.map((f) => f.label + (f.lines ? ` (lines ${f.lines.start}-${f.lines.end})` : ""));
  return (
    "I'm working on code in VS Code. Use the attached files from my workspace as context " +
    `(${[...new Set(names)].join(", ")}) to answer:\n\n${question}`
  );
}

export function toCopilotContext(files: readonly ContextFile[]): CopilotContext[] {
  return files.map((file) => ({ text: formatContextFile(file), description: describeReason(file) }));
}

/** Gathers and packs the editor and workspace context for a question. */
export async function collectContext(
  question: string,
  references: readonly (vscode.Uri | vscode.Location)[] = [],
  token?: vscode.CancellationToken,
): Promise<PackedContext> {
  const settings = readContextSettings();
  const files = await gatherContext(question, { references, token }, settings);
  return packContext(files, settings.maxCharacters);
}

/** Asks Copilot one question with context, in a new or existing conversation. */
export async function ask(
  client: CopilotClient,
  question: string,
  packed: PackedContext,
  conversationId: string | undefined,
  signal?: AbortSignal,
): Promise<{ reply: string; conversationId: string }> {
  const id = conversationId ?? (await client.createConversation(signal));
  const reply = await client.chat(id, buildPrompt(question, packed.files), toCopilotContext(packed.files), signal);
  return { reply, conversationId: id };
}

function abortOn(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();
  token.onCancellationRequested(() => controller.abort());
  return controller.signal;
}

function chatReferences(request: vscode.ChatRequest): (vscode.Uri | vscode.Location)[] {
  return request.references.map((r) => r.value).filter((v): v is vscode.Uri | vscode.Location => v instanceof vscode.Uri || v instanceof vscode.Location);
}

/** The Copilot conversation this chat session already started, so follow-ups keep their history. */
function previousConversation(context: vscode.ChatContext): string | undefined {
  for (let i = context.history.length - 1; i >= 0; i--) {
    const turn = context.history[i];
    if (turn instanceof vscode.ChatResponseTurn && turn.participant === PARTICIPANT_ID) {
      const id = turn.result.metadata?.conversationId;
      if (typeof id === "string") {
        return id;
      }
    }
  }
  return undefined;
}

/** Registers `@m365` in VS Code's chat view. Returns undefined when this VS Code has no chat UI. */
export function registerChatParticipant(client: CopilotClient): vscode.Disposable | undefined {
  if (typeof vscode.chat?.createChatParticipant !== "function") {
    return undefined;
  }
  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, async (request, context, stream, token) => {
    stream.progress("Reading your editor and workspace files...");
    const packed = await collectContext(request.prompt, chatReferences(request), token);
    for (const file of packed.files) {
      stream.reference(file.lines ? new vscode.Location(file.uri, new vscode.Range(file.lines.start - 1, 0, file.lines.end - 1, 0)) : file.uri);
    }
    stream.progress("Asking Microsoft 365 Copilot...");
    try {
      const { reply, conversationId } = await ask(client, request.prompt, packed, previousConversation(context), abortOn(token));
      stream.markdown(reply);
      if (packed.omitted.length > 0) {
        stream.markdown(`\n\n_Left out to fit the context budget: ${packed.omitted.join(", ")}._`);
      }
      return { metadata: { conversationId } };
    } catch (err) {
      if (token.isCancellationRequested) {
        return {};
      }
      return { errorDetails: { message: err instanceof Error ? err.message : String(err) } };
    }
  });
  participant.iconPath = new vscode.ThemeIcon("copilot");
  return participant;
}

/** `365 Copilot Code: Ask Microsoft 365 Copilot...` for VS Code builds without the chat view. */
export function registerAskCommand(client: CopilotClient): vscode.Disposable {
  return vscode.commands.registerCommand("365CopilotCode.ask", async (prefill?: string) => {
    const question = await vscode.window.showInputBox({
      title: "Ask Microsoft 365 Copilot",
      prompt: "Your question is sent with the active file (or selection) and related workspace files.",
      value: typeof prefill === "string" ? prefill : undefined,
      ignoreFocusOut: true,
    });
    if (!question?.trim()) {
      return;
    }
    try {
      const reply = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Asking Microsoft 365 Copilot", cancellable: true },
        async (progress, token) => {
          progress.report({ message: "Reading files..." });
          const packed = await collectContext(question, [], token);
          progress.report({ message: `Sending ${packed.files.length} file${packed.files.length === 1 ? "" : "s"} as context...` });
          const result = await ask(client, question, packed, undefined, abortOn(token));
          return { ...result, packed };
        },
      );
      const sources = reply.packed.files.map((f) => `- ${f.label}${f.lines ? ` (lines ${f.lines.start}-${f.lines.end})` : ""}${f.truncated ? " (truncated)" : ""}`);
      await showAnswer(question, `${reply.reply}\n\n---\n\n**Context sent:**\n\n${sources.join("\n") || "- none"}\n`);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    }
  });
}

/** Shows an answer in a read-only panel, rendered with VS Code's built-in Markdown renderer. */
async function showAnswer(question: string, markdown: string): Promise<void> {
  let body: string;
  try {
    body = await vscode.commands.executeCommand<string>("markdown.api.render", markdown);
  } catch {
    body = `<pre>${escapeHtml(markdown)}</pre>`;
  }
  const panel = vscode.window.createWebviewPanel("365CopilotCode.answer", `Copilot: ${question.slice(0, 40)}`, vscode.ViewColumn.Beside, {
    enableScripts: false,
  });
  panel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:;"></head>
<body style="font-family: var(--vscode-font-family); padding: 0 16px;"><h2>${escapeHtml(question)}</h2>${body}</body></html>`;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

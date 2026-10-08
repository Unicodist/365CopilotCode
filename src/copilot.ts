/**
 * Client for the Microsoft 365 Copilot Chat API (Microsoft Graph beta).
 * https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/overview
 */
export const COPILOT_API_BASE = "https://graph.microsoft.com/beta/copilot";

/** Extra text sent alongside the prompt; the API's `additionalContext` entries. */
export interface CopilotContext {
  text: string;
  description?: string;
}

export interface ChatRequestBody {
  message: { text: string };
  locationHint: { timeZone: string };
  additionalContext?: CopilotContext[];
}

export class CopilotApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "CopilotApiError";
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export function buildChatBody(prompt: string, context: readonly CopilotContext[], timeZone = defaultTimeZone()): ChatRequestBody {
  const body: ChatRequestBody = { message: { text: prompt }, locationHint: { timeZone } };
  if (context.length > 0) {
    body.additionalContext = [...context];
  }
  return body;
}

/** Copilot's answer from a chat response: the last message that is not the user's own prompt. */
export function extractReply(conversation: unknown, prompt: string): string {
  const messages = (conversation as { messages?: { text?: string }[] } | undefined)?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i].text;
    if (text && text !== prompt) {
      return text;
    }
  }
  throw new CopilotApiError("Microsoft 365 Copilot returned no answer.", 200);
}

function defaultTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export class CopilotClient {
  constructor(
    private readonly getAccessToken: () => Promise<string>,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  /** Starts a new Copilot conversation and returns its id. */
  async createConversation(signal?: AbortSignal): Promise<string> {
    const result = (await this.post("/conversations", {}, signal)) as { id?: string };
    if (!result?.id) {
      throw new CopilotApiError("Microsoft 365 Copilot did not return a conversation id.", 200);
    }
    return result.id;
  }

  /** Sends a prompt, with optional file context, to a conversation and returns Copilot's reply. */
  async chat(conversationId: string, prompt: string, context: readonly CopilotContext[] = [], signal?: AbortSignal): Promise<string> {
    const result = await this.post(`/conversations/${encodeURIComponent(conversationId)}/chat`, buildChatBody(prompt, context), signal);
    return extractReply(result, prompt);
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const token = await this.getAccessToken();
    const response = await this.fetchImpl(COPILOT_API_BASE + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw toApiError(response.status, text);
    }
    return text ? JSON.parse(text) : undefined;
  }
}

function toApiError(status: number, text: string): CopilotApiError {
  let code: string | undefined;
  let detail = text.slice(0, 300);
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    code = parsed.error?.code;
    detail = parsed.error?.message ?? detail;
  } catch {
    // Not JSON; keep the raw text.
  }
  let hint = "";
  if (status === 401) {
    hint = " Try signing in again.";
  } else if (status === 403) {
    hint = " Your account needs a Microsoft 365 Copilot license and admin consent for the Copilot Chat API permissions.";
  } else if (status === 429) {
    hint = " Copilot is rate limiting requests; wait a moment and try again.";
  }
  return new CopilotApiError(`Microsoft 365 Copilot request failed (${status}${code ? ` ${code}` : ""}): ${detail}${hint}`, status, code);
}

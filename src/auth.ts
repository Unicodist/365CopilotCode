import * as vscode from "vscode";

/** VS Code's built-in Microsoft (Entra ID) authentication provider. */
export const PROVIDER_ID = "microsoft";

/**
 * Delegated Microsoft Graph permissions the Microsoft 365 Copilot Chat API needs.
 * All of them are required; see
 * https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/copilotroot-post-conversations
 */
export const COPILOT_GRAPH_SCOPES = [
  "https://graph.microsoft.com/Sites.Read.All",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/People.Read.All",
  "https://graph.microsoft.com/OnlineMeetingTranscript.Read.All",
  "https://graph.microsoft.com/Chat.Read",
  "https://graph.microsoft.com/ChannelMessage.Read.All",
  "https://graph.microsoft.com/ExternalItem.Read.All",
];

const SIGNED_OUT_KEY = "auth.signedOut";

export interface AuthSettings {
  clientId?: string;
  tenantId?: string;
}

/**
 * Builds the scope list passed to the Microsoft auth provider. The provider reads the
 * special `VSCODE_CLIENT_ID:` and `VSCODE_TENANT:` entries to pick the Entra app
 * registration and tenant instead of VS Code's own.
 */
export function buildScopes(settings: AuthSettings): string[] {
  const scopes = [...COPILOT_GRAPH_SCOPES, "offline_access"];
  const clientId = settings.clientId?.trim();
  const tenantId = settings.tenantId?.trim();
  if (clientId) {
    scopes.push(`VSCODE_CLIENT_ID:${clientId}`);
  }
  if (tenantId) {
    scopes.push(`VSCODE_TENANT:${tenantId}`);
  }
  return scopes;
}

function readSettings(): AuthSettings {
  const config = vscode.workspace.getConfiguration("365CopilotCode.auth");
  return {
    clientId: config.get<string>("clientId"),
    tenantId: config.get<string>("tenantId"),
  };
}

/**
 * Owns the Microsoft 365 sign-in state for the extension and hands out Graph access
 * tokens for calls to the Microsoft 365 Copilot APIs.
 */
export class AuthManager implements vscode.Disposable {
  private session: vscode.AuthenticationSession | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<vscode.AuthenticationSession | undefined>();
  private readonly disposables: vscode.Disposable[] = [];

  /** Fires whenever the signed-in session changes (undefined when signed out). */
  readonly onDidChangeSession = this.changeEmitter.event;

  constructor(private readonly state: vscode.Memento) {
    this.disposables.push(
      this.changeEmitter,
      vscode.authentication.onDidChangeSessions((e) => {
        if (e.provider.id === PROVIDER_ID) {
          void this.refresh();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("365CopilotCode.auth")) {
          void this.refresh();
        }
      }),
    );
  }

  get currentSession(): vscode.AuthenticationSession | undefined {
    return this.session;
  }

  /** Picks up an existing session silently, without prompting the user. */
  async refresh(): Promise<vscode.AuthenticationSession | undefined> {
    if (this.state.get<boolean>(SIGNED_OUT_KEY)) {
      this.setSession(undefined);
      return undefined;
    }
    try {
      const session = await vscode.authentication.getSession(PROVIDER_ID, buildScopes(readSettings()), {
        silent: true,
      });
      this.setSession(session);
    } catch {
      this.setSession(undefined);
    }
    return this.session;
  }

  /** Prompts the user to sign in with their work or school account. */
  async signIn(): Promise<vscode.AuthenticationSession> {
    const session = await vscode.authentication.getSession(PROVIDER_ID, buildScopes(readSettings()), {
      createIfNone: true,
      clearSessionPreference: true,
    });
    await this.state.update(SIGNED_OUT_KEY, false);
    this.setSession(session);
    return session;
  }

  /**
   * Stops this extension from using the account. Extensions cannot remove an account
   * from VS Code itself; that is done from the Accounts menu.
   */
  async signOut(): Promise<void> {
    await this.state.update(SIGNED_OUT_KEY, true);
    this.setSession(undefined);
  }

  /**
   * Returns a Microsoft Graph access token with the Copilot scopes, prompting the user to
   * sign in if they have not yet.
   */
  async getAccessToken(): Promise<string> {
    if (this.state.get<boolean>(SIGNED_OUT_KEY) || !this.session) {
      return (await this.signIn()).accessToken;
    }
    // Ask again rather than caching the token so VS Code can hand back a refreshed one.
    const session = await vscode.authentication.getSession(PROVIDER_ID, buildScopes(readSettings()), {
      createIfNone: true,
    });
    this.setSession(session);
    return session.accessToken;
  }

  private setSession(session: vscode.AuthenticationSession | undefined) {
    const changed = session?.id !== this.session?.id || session?.account.id !== this.session?.account.id;
    this.session = session;
    if (changed) {
      this.changeEmitter.fire(session);
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

import * as vscode from "vscode";
import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type ICachePlugin,
  type TokenCacheContext,
} from "@azure/msal-node";

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

/** How long to wait for the user to finish signing in in the browser. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

const ACCOUNT_KEY = "auth.accountId";

export interface AuthSettings {
  clientId?: string;
  tenantId?: string;
}

/** The account the extension is signed in with. */
export interface SignedInAccount {
  /** MSAL's home account id. */
  id: string;
  /** User name shown in the UI, usually the email address. */
  label: string;
}

/** Thrown when sign-in is attempted before an app registration's client ID is configured. */
export class MissingClientIdError extends Error {
  constructor() {
    super("Set 365CopilotCode.auth.clientId to your Microsoft Entra app registration's client ID before signing in.");
    this.name = "MissingClientIdError";
  }
}

/** The Entra sign-in authority: the configured tenant, or any work or school account. */
export function buildAuthority(settings: AuthSettings): string {
  const tenant = settings.tenantId?.trim() || "organizations";
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}`;
}

function readSettings(): AuthSettings {
  const config = vscode.workspace.getConfiguration("365CopilotCode.auth");
  return {
    clientId: config.get<string>("clientId"),
    tenantId: config.get<string>("tenantId"),
  };
}

/** The parts of MSAL's public client the extension uses, so tests can swap in a fake. */
export interface TokenClient {
  getAllAccounts(): Promise<AccountInfo[]>;
  acquireTokenSilent(request: { account: AccountInfo; scopes: string[] }): Promise<AuthenticationResult>;
  acquireTokenInteractive(request: {
    scopes: string[];
    prompt: string;
    openBrowser: (url: string) => Promise<void>;
    successTemplate: string;
    errorTemplate: string;
  }): Promise<AuthenticationResult>;
  removeAccount(account: AccountInfo): Promise<void>;
}

export type TokenClientFactory = (clientId: string, authority: string, secrets: vscode.SecretStorage) => TokenClient;

/** Keeps MSAL's token cache in VS Code's secret storage, one entry per client ID. */
class SecretStorageCachePlugin implements ICachePlugin {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly key: string,
  ) {}

  async beforeCacheAccess(context: TokenCacheContext): Promise<void> {
    const data = await this.secrets.get(this.key);
    if (data) {
      context.tokenCache.deserialize(data);
    }
  }

  async afterCacheAccess(context: TokenCacheContext): Promise<void> {
    if (context.cacheHasChanged) {
      await this.secrets.store(this.key, context.tokenCache.serialize());
    }
  }
}

const createMsalClient: TokenClientFactory = (clientId, authority, secrets) => {
  const pca = new PublicClientApplication({
    auth: { clientId, authority },
    cache: { cachePlugin: new SecretStorageCachePlugin(secrets, `msal.cache.${clientId}`) },
  });
  return {
    getAllAccounts: () => pca.getAllAccounts(),
    acquireTokenSilent: (request) => pca.acquireTokenSilent(request),
    acquireTokenInteractive: (request) => pca.acquireTokenInteractive(request),
    removeAccount: (account) => pca.getTokenCache().removeAccount(account),
  };
};

const PAGE_STYLE = "font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem;";
const SUCCESS_PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signed in</title></head><body style="${PAGE_STYLE}"><h1>Signed in to Microsoft 365 Copilot</h1><p>You can close this tab and go back to VS Code.</p></body></html>`;
const ERROR_PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign-in failed</title></head><body style="${PAGE_STYLE}"><h1>Sign-in failed</h1><p>Go back to VS Code to see what went wrong and try again.</p></body></html>`;

/**
 * Owns the Microsoft 365 sign-in state for the extension and hands out Graph access
 * tokens for calls to the Microsoft 365 Copilot APIs. Sign-in opens the user's default
 * browser (authorization code flow with PKCE and a localhost redirect), so it works the
 * same on every platform and never goes through the OS account broker.
 */
export class AuthManager implements vscode.Disposable {
  private account: SignedInAccount | undefined;
  private client: { key: string; client: TokenClient } | undefined;
  private signInInProgress: Promise<SignedInAccount> | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<SignedInAccount | undefined>();
  private readonly disposables: vscode.Disposable[] = [];

  /** Fires whenever the signed-in account changes (undefined when signed out). */
  readonly onDidChangeAccount = this.changeEmitter.event;

  constructor(
    private readonly state: vscode.Memento,
    private readonly secrets: vscode.SecretStorage,
    private readonly createClient: TokenClientFactory = createMsalClient,
  ) {
    this.disposables.push(
      this.changeEmitter,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("365CopilotCode.auth")) {
          void this.refresh();
        }
      }),
    );
  }

  get currentAccount(): SignedInAccount | undefined {
    return this.account;
  }

  /** Picks up the account from a previous sign-in, without prompting the user. */
  async refresh(): Promise<SignedInAccount | undefined> {
    const client = this.tokenClient();
    const id = this.state.get<string>(ACCOUNT_KEY);
    if (!client || !id) {
      this.setAccount(undefined);
      return undefined;
    }
    try {
      const match = (await client.getAllAccounts()).find((a) => a.homeAccountId === id);
      this.setAccount(match ? toSignedIn(match) : undefined);
    } catch {
      this.setAccount(undefined);
    }
    return this.account;
  }

  /** Opens the default browser so the user can sign in with their work or school account. */
  signIn(): Promise<SignedInAccount> {
    // Several requests can need a sign-in at once; share one browser round trip.
    this.signInInProgress ??= this.doSignIn().finally(() => (this.signInInProgress = undefined));
    return this.signInInProgress;
  }

  private async doSignIn(): Promise<SignedInAccount> {
    const client = this.tokenClient();
    if (!client) {
      throw new MissingClientIdError();
    }
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Signing in to Microsoft 365 in your browser...", cancellable: true },
      (_progress, token) =>
        withCancellation(
          client.acquireTokenInteractive({
            scopes: COPILOT_GRAPH_SCOPES,
            prompt: "select_account",
            openBrowser: async (url) => {
              if (!(await vscode.env.openExternal(vscode.Uri.parse(url)))) {
                throw new Error("Could not open the browser to sign in.");
              }
            },
            successTemplate: SUCCESS_PAGE,
            errorTemplate: ERROR_PAGE,
          }),
          token,
          SIGN_IN_TIMEOUT_MS,
        ),
    );
    if (!result.account) {
      throw new Error("Microsoft sign-in did not return an account.");
    }
    await this.state.update(ACCOUNT_KEY, result.account.homeAccountId);
    const account = toSignedIn(result.account);
    this.setAccount(account);
    return account;
  }

  /** Signs out of the extension and deletes its cached tokens for the account. */
  async signOut(): Promise<void> {
    const id = this.state.get<string>(ACCOUNT_KEY);
    await this.state.update(ACCOUNT_KEY, undefined);
    this.setAccount(undefined);
    const client = this.tokenClient();
    if (client && id) {
      const match = (await client.getAllAccounts()).find((a) => a.homeAccountId === id);
      if (match) {
        await client.removeAccount(match);
      }
    }
  }

  /**
   * Returns a Microsoft Graph access token with the Copilot scopes, refreshing it silently
   * when possible and opening the browser to sign in when not.
   */
  async getAccessToken(): Promise<string> {
    const client = this.tokenClient();
    if (!client) {
      throw new MissingClientIdError();
    }
    const id = this.state.get<string>(ACCOUNT_KEY);
    const msalAccount = id ? (await client.getAllAccounts()).find((a) => a.homeAccountId === id) : undefined;
    if (msalAccount) {
      try {
        return (await client.acquireTokenSilent({ account: msalAccount, scopes: COPILOT_GRAPH_SCOPES })).accessToken;
      } catch (err) {
        if (!(err instanceof InteractionRequiredAuthError)) {
          throw err;
        }
      }
    }
    await this.signIn();
    const signedIn = (await client.getAllAccounts()).find((a) => a.homeAccountId === this.state.get<string>(ACCOUNT_KEY));
    if (!signedIn) {
      throw new Error("Microsoft sign-in did not complete.");
    }
    return (await client.acquireTokenSilent({ account: signedIn, scopes: COPILOT_GRAPH_SCOPES })).accessToken;
  }

  /** The token client for the configured app registration, or undefined when none is set. */
  private tokenClient(): TokenClient | undefined {
    const settings = readSettings();
    const clientId = settings.clientId?.trim();
    if (!clientId) {
      return undefined;
    }
    const authority = buildAuthority(settings);
    const key = `${clientId}|${authority}`;
    if (this.client?.key !== key) {
      this.client = { key, client: this.createClient(clientId, authority, this.secrets) };
    }
    return this.client.client;
  }

  private setAccount(account: SignedInAccount | undefined) {
    const changed = account?.id !== this.account?.id;
    this.account = account;
    if (changed) {
      this.changeEmitter.fire(account);
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

/** Explains a failed sign-in, offering the settings when the app registration is missing. */
export async function showSignInError(err: unknown): Promise<void> {
  if (err instanceof vscode.CancellationError) {
    return;
  }
  if (err instanceof MissingClientIdError) {
    const open = "Open Settings";
    const choice = await vscode.window.showWarningMessage(
      "Microsoft 365 Copilot needs your organization's Microsoft Entra app registration. Set its client ID (and tenant) in Settings, then sign in again.",
      open,
    );
    if (choice === open) {
      await vscode.commands.executeCommand("workbench.action.openSettings", "365CopilotCode.auth");
    }
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  vscode.window.showErrorMessage(`Microsoft 365 sign-in failed: ${message}`);
}

function toSignedIn(account: AccountInfo): SignedInAccount {
  return { id: account.homeAccountId, label: account.username || account.name || "Microsoft account" };
}

/** Rejects when the user cancels or the timeout passes, whichever comes first. */
function withCancellation<T>(promise: Promise<T>, token: vscode.CancellationToken, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Sign-in timed out. Try again and finish signing in in the browser."));
    }, timeoutMs);
    const listener = token.onCancellationRequested(() => {
      cleanup();
      reject(new vscode.CancellationError());
    });
    const cleanup = () => {
      clearTimeout(timer);
      listener.dispose();
    };
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (err) => {
        cleanup();
        reject(err);
      },
    );
  });
}

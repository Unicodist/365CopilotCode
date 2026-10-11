import * as assert from "assert";
import * as vscode from "vscode";
import { InteractionRequiredAuthError, type AccountInfo, type AuthenticationResult } from "@azure/msal-node";
import { AuthManager, buildAuthority, COPILOT_GRAPH_SCOPES, MissingClientIdError, type TokenClient } from "../auth";

suite("buildAuthority", () => {
  test("signs in any work or school account by default", () => {
    assert.strictEqual(buildAuthority({}), "https://login.microsoftonline.com/organizations");
    assert.strictEqual(buildAuthority({ tenantId: "  " }), "https://login.microsoftonline.com/organizations");
  });

  test("uses the configured tenant", () => {
    assert.strictEqual(buildAuthority({ tenantId: " contoso.onmicrosoft.com " }), "https://login.microsoftonline.com/contoso.onmicrosoft.com");
  });
});

class MemoryMemento implements vscode.Memento {
  private readonly values = new Map<string, unknown>();
  keys() {
    return [...this.values.keys()];
  }
  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined;
  }
  async update(key: string, value: unknown) {
    if (value === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, value);
    }
  }
}

const noSecrets = {} as vscode.SecretStorage;

/** A stand-in for MSAL that signs in one account and records what it was asked. */
class FakeTokenClient implements TokenClient {
  accounts: AccountInfo[] = [];
  interactiveCalls = 0;
  silentError: Error | undefined;
  readonly account = { homeAccountId: "home-1", username: "ash@contoso.com" } as AccountInfo;

  async getAllAccounts() {
    return [...this.accounts];
  }
  async acquireTokenSilent(request: { account: AccountInfo; scopes: string[] }) {
    if (this.silentError) {
      const err = this.silentError;
      this.silentError = undefined;
      throw err;
    }
    assert.deepStrictEqual(request.scopes, COPILOT_GRAPH_SCOPES);
    return { accessToken: `token-for-${request.account.homeAccountId}`, account: request.account } as AuthenticationResult;
  }
  async acquireTokenInteractive(request: { scopes: string[]; prompt: string }) {
    this.interactiveCalls++;
    assert.deepStrictEqual(request.scopes, COPILOT_GRAPH_SCOPES);
    assert.strictEqual(request.prompt, "select_account");
    this.accounts = [this.account];
    return { accessToken: "interactive-token", account: this.account } as AuthenticationResult;
  }
  async removeAccount(account: AccountInfo) {
    this.accounts = this.accounts.filter((a) => a.homeAccountId !== account.homeAccountId);
  }
}

suite("AuthManager", () => {
  const config = () => vscode.workspace.getConfiguration("365CopilotCode.auth");

  teardown(async () => {
    await config().update("clientId", undefined, vscode.ConfigurationTarget.Global);
  });

  test("asks for an app registration before signing in", async () => {
    const auth = new AuthManager(new MemoryMemento(), noSecrets, () => assert.fail("no client without a client ID"));
    await assert.rejects(auth.signIn(), MissingClientIdError);
    await assert.rejects(auth.getAccessToken(), MissingClientIdError);
    assert.strictEqual(await auth.refresh(), undefined);
    auth.dispose();
  });

  test("signs in through the browser, reuses the account silently, and signs out", async () => {
    await config().update("clientId", "11111111-2222-3333-4444-555555555555", vscode.ConfigurationTarget.Global);
    const fake = new FakeTokenClient();
    const created: { clientId: string; authority: string }[] = [];
    const state = new MemoryMemento();
    const auth = new AuthManager(state, noSecrets, (clientId, authority) => {
      created.push({ clientId, authority });
      return fake;
    });

    const account = await auth.signIn();
    assert.deepStrictEqual(account, { id: "home-1", label: "ash@contoso.com" });
    assert.deepStrictEqual(created, [{ clientId: "11111111-2222-3333-4444-555555555555", authority: "https://login.microsoftonline.com/organizations" }]);

    assert.strictEqual(await auth.getAccessToken(), "token-for-home-1");
    assert.strictEqual(fake.interactiveCalls, 1, "a cached account does not open the browser again");

    // A new manager (for example after a reload) finds the account without prompting.
    const reloaded = new AuthManager(state, noSecrets, () => fake);
    assert.deepStrictEqual(await reloaded.refresh(), account);

    await auth.signOut();
    assert.strictEqual(auth.currentAccount, undefined);
    assert.deepStrictEqual(fake.accounts, [], "cached tokens are removed");
    auth.dispose();
    reloaded.dispose();
  });

  test("opens the browser again when the token can't be refreshed silently", async () => {
    await config().update("clientId", "11111111-2222-3333-4444-555555555555", vscode.ConfigurationTarget.Global);
    const fake = new FakeTokenClient();
    const auth = new AuthManager(new MemoryMemento(), noSecrets, () => fake);
    await auth.signIn();

    fake.silentError = new InteractionRequiredAuthError("interaction_required", "test");
    assert.strictEqual(await auth.getAccessToken(), "token-for-home-1");
    assert.strictEqual(fake.interactiveCalls, 2);
    auth.dispose();
  });
});

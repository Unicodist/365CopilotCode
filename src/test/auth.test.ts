import * as assert from "assert";
import { buildScopes, COPILOT_GRAPH_SCOPES } from "../auth";

suite("buildScopes", () => {
  test("requests every Copilot Graph permission plus a refresh token", () => {
    const scopes = buildScopes({});
    for (const scope of COPILOT_GRAPH_SCOPES) {
      assert.ok(scopes.includes(scope), `missing ${scope}`);
    }
    assert.ok(scopes.includes("offline_access"));
    assert.ok(!scopes.some((s) => s.startsWith("VSCODE_")));
  });

  test("adds the custom client and tenant when configured", () => {
    const scopes = buildScopes({ clientId: " 11111111-2222-3333-4444-555555555555 ", tenantId: "contoso.onmicrosoft.com" });
    assert.ok(scopes.includes("VSCODE_CLIENT_ID:11111111-2222-3333-4444-555555555555"));
    assert.ok(scopes.includes("VSCODE_TENANT:contoso.onmicrosoft.com"));
  });

  test("ignores blank settings", () => {
    const scopes = buildScopes({ clientId: "  ", tenantId: "" });
    assert.ok(!scopes.some((s) => s.startsWith("VSCODE_")));
  });
});

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createPlugin } from "../server.js";
import * as github from "../src/github/projects.js";
import { boardSchema } from "../src/contracts.js";

async function setup(t: TestContext, inaccessible = false, failSearch = false) {
  const calls: unknown[][] = []; let writes = 0;
  const board = boardSchema.parse({ id: "p", title: "P", number: 1, url: "https://github.com/orgs/acme/projects/1", closed: false, description: null, viewerCanUpdate: false, statusField: null, singleSelectFields: [], fields: [], dateFields: [], items: [{ itemId: "draft", contentId: "d", kind: "DraftIssue", number: null, title: "Draft", body: "", url: null, repository: null, reference: null, state: null, isDraft: false, author: null, assignees: [{ login: "Alice", avatarUrl: "https://example.test/alice" }, { login: "alice", avatarUrl: null }], labels: [], milestone: null, issueType: null, updatedAt: null, singleSelect: {}, numbers: {}, text: {}, viewerCanUpdate: false }] });
  const fake = { ...github, fetchProjectBoard: async () => { if (inaccessible) throw new Error("Project access denied"); return board; }, fetchViewerLogin: async () => "viewer", createProjectTask: async () => { writes++; throw new Error("unexpected write"); }, setAssignees: async () => { writes++; }, addComment: async () => { writes++; return {}; } };
  const host = createFakePluginHost({ settings: { projectUrls: "https://github.com/orgs/acme/projects/1", tokenFile: "/private/mock-token-file", refreshMinutes: 0 } });
  t.after(() => host.harness.dispose());
  await createPlugin(fake, { suggestCommentUsers: async (...args) => { calls.push(args); if (failSearch) throw new Error("Repository permission denied"); return [{ login: "bob", name: "Bob Example", avatarUrl: null }]; }, uploadCommentAttachment: async () => { throw new Error("unexpected upload"); } })(host.bb);
  return { calls, writes: () => writes, rpc: (input: unknown) => host.harness.callRpc("assignees_list", input) as Promise<any> };
}

test("assignee lookup validates project access and repository before remote search", async t => {
  const h = await setup(t);
  await assert.rejects(h.rpc({ projectKey: "foreign:1", repository: "acme/repo", query: "" }));
  await assert.rejects(h.rpc({ projectKey: "acme:1", repository: "https://github.com/acme/repo", query: "" }));
  assert.deepEqual(h.calls, []); assert.equal(h.writes(), 0);
  const denied = await setup(t, true);
  await assert.rejects(denied.rpc({ projectKey: "acme:1", repository: "acme/repo", query: "" }), /Project access denied/);
  assert.deepEqual(denied.calls, []);
});
test("read-only project can request repository assignable users with credential options", async t => {
  const h = await setup(t);
  const result = await h.rpc({ projectKey: "acme:1", repository: " acme/repo ", query: " bob " });
  assert.deepEqual(h.calls[0].slice(0, 2), ["acme/repo", "bob"]);
  const opts = h.calls[0][2] as {tokenFile: string; signal: AbortSignal};
  assert.equal(opts.tokenFile, "/private/mock-token-file"); assert.ok(opts.signal instanceof AbortSignal);
  assert.deepEqual(result.users, [{ login: "bob", name: "Bob Example", avatarUrl: null }]);
  assert.doesNotMatch(JSON.stringify(result), /mock-token-file|tokenFile/); assert.equal(h.writes(), 0);
});
test("draft creation fallback deduplicates project assignees and includes viewer without item ID", async t => {
  const h = await setup(t);
  const result = await h.rpc({ projectKey: "acme:1", repository: null, query: "" });
  assert.deepEqual(result.users.map((u: any) => u.login), ["Alice", "viewer"]);
  const filtered = await h.rpc({ projectKey: "acme:1", query: "ALIC" });
  assert.deepEqual(filtered.users.map((u: any) => u.login), ["Alice"]);
  assert.deepEqual(h.calls, []); assert.equal(h.writes(), 0);
});
test("repository permission errors remain actionable and do not trigger writes", async t => {
  const h = await setup(t, false, true);
  await assert.rejects(h.rpc({ projectKey: "acme:1", repository: "acme/repo", query: "" }), /Repository permission denied/);
  assert.equal(h.calls.length, 1); assert.equal(h.writes(), 0);
});

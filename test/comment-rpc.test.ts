import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createPlugin } from "../server.js";
import * as github from "../src/github/projects.js";
import { boardSchema, type ProjectBoard } from "../src/contracts.js";

const itemRef = { projectKey: "acme:1", itemId: "i" };
const upload = {
  ...itemRef,
  name: "shot.png",
  contentType: "image/png",
  base64: Buffer.from("test media").toString("base64"),
};
function fixture(): ProjectBoard {
  return boardSchema.parse({
    id: "p",
    title: "P",
    number: 1,
    url: "https://github.com/orgs/acme/projects/1",
    closed: false,
    description: null,
    viewerCanUpdate: true,
    statusField: null,
    singleSelectFields: [],
    fields: [],
    dateFields: [],
    warnings: [],
    items: [
      {
        itemId: "i",
        contentId: "issue",
        kind: "Issue",
        number: 1,
        title: "Task",
        body: "",
        url: null,
        repository: "acme/repo",
        reference: null,
        state: "OPEN",
        isDraft: false,
        author: null,
        assignees: [],
        labels: [],
        milestone: null,
        issueType: null,
        updatedAt: null,
        singleSelect: {},
        numbers: {},
        text: {},
        viewerCanUpdate: false,
        warnings: [],
      },
    ],
  });
}
async function setup(
  t: TestContext,
  { draft = false, canComment = true, failUpload = false } = {},
) {
  const calls: { type: string; args: unknown[] }[] = [];
  let commentsWritten = 0;
  const value = fixture();
  if (draft) {
    value.items[0].kind = "DraftIssue";
    value.items[0].repository = null;
  }
  const fake = {
    ...github,
    fetchProjectBoard: async () => value,
    fetchViewerLogin: async () => "me",
    fetchItemDetail: async () => ({
      contentId: "issue",
      body: "",
      comments: [],
      commentsHasMore: false,
      commentsCursor: null,
      viewerCanUpdate: false,
      viewerCanComment: canComment,
      linkedPullRequests: [],
      warnings: [],
    }),
    addComment: async () => {
      commentsWritten++;
      return {};
    },
  };
  const services = {
    suggestCommentUsers: async (
      ...args: Parameters<
        typeof import("../src/github/comment-features.js").suggestCommentUsers
      >
    ) => {
      calls.push({ type: "users", args });
      return [{ login: "alice", name: "Alice", avatarUrl: null }];
    },
    uploadCommentAttachment: async (
      ...args: Parameters<
        typeof import("../src/github/attachments.js").uploadCommentAttachment
      >
    ) => {
      calls.push({ type: "upload", args });
      if (failUpload) throw new Error("GitHub upload refused");
      return {
        name: args[1],
        url: "https://github.com/user-attachments/assets/test",
        markdown: "![shot](https://github.com/user-attachments/assets/test)",
      };
    },
  };
  const host = createFakePluginHost({
    settings: {
      projectUrls: "https://github.com/orgs/acme/projects/1",
      tokenFile: "/private/mock-token-file",
      refreshMinutes: 0,
    },
  });
  t.after(() => host.harness.dispose());
  await createPlugin(fake, services)(host.bb);
  return {
    ...host,
    calls,
    commentsWritten: () => commentsWritten,
    rpc: (method: string, input: unknown) =>
      host.harness.callRpc(method, input) as Promise<any>,
  };
}

test("comment helpers reject foreign project/item membership before invocation", async (t) => {
  const h = await setup(t);
  for (const foreign of [
    { projectKey: "other:1", itemId: "i" },
    { projectKey: "acme:1", itemId: "other-item" },
  ]) {
    await assert.rejects(h.rpc("comment_users", { ...foreign, query: "a" }));
    await assert.rejects(h.rpc("comment_upload", { ...upload, ...foreign }));
  }
  assert.deepEqual(h.calls, []);
  assert.equal(h.commentsWritten(), 0);
});
test("draft uploads and unavailable comment permissions fail before upload helper", async (t) => {
  const draft = await setup(t, { draft: true });
  await assert.rejects(draft.rpc("comment_upload", upload));
  assert.deepEqual(draft.calls, []);
  const locked = await setup(t, { canComment: false });
  await assert.rejects(locked.rpc("comment_upload", upload));
  assert.deepEqual(locked.calls, []);
});
test("rejects malformed/noncanonical base64, empty and oversized decoded uploads", async (t) => {
  const h = await setup(t);
  for (const base64 of [
    "!bad",
    "YQ",
    "YQ===",
    "YR==",
    "",
    Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"),
    "A".repeat(7_000_001),
  ]) {
    await assert.rejects(h.rpc("comment_upload", { ...upload, base64 }));
  }
  assert.deepEqual(h.calls, []);
});
test("media upload passes decoded Buffer and source repository, never posts a comment", async (t) => {
  const h = await setup(t);
  const result = await h.rpc("comment_upload", upload);
  const call = h.calls[0];
  assert.equal(call.type, "upload");
  assert.equal(call.args[0], "acme/repo");
  assert.equal(call.args[1], "shot.png");
  assert.equal(call.args[2], "image/png");
  assert.ok(Buffer.isBuffer(call.args[3]));
  assert.deepEqual(call.args[3], Buffer.from("test media"));
  assert.deepEqual(Object.keys(result).sort(), ["markdown", "name", "url"]);
  assert.doesNotMatch(JSON.stringify(result), /private\/mock-token|tokenFile/);
  assert.equal(h.commentsWritten(), 0);
});
test("suggestions pass repository and query without exposing private token configuration", async (t) => {
  const h = await setup(t);
  const result = await h.rpc("comment_users", { ...itemRef, query: "ali" });
  assert.equal(h.calls[0].type, "users");
  assert.equal(h.calls[0].args[0], "acme/repo");
  assert.equal(h.calls[0].args[1], "ali");
  assert.deepEqual(result, {
    users: [{ login: "alice", name: "Alice", avatarUrl: null }],
  });
  assert.doesNotMatch(JSON.stringify(result), /private\/mock-token|tokenFile/);
  assert.equal(h.commentsWritten(), 0);
});
test("upload helper failure surfaces once without posting a comment", async (t) => {
  const h = await setup(t, { failUpload: true });
  await assert.rejects(
    h.rpc("comment_upload", upload),
    /GitHub upload refused/,
  );
  assert.equal(h.calls.length, 1);
  assert.equal(h.commentsWritten(), 0);
});

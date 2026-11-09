import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createPlugin } from "../server.js";
import * as github from "../src/github/projects.js";
import { boardSchema } from "../src/contracts.js";
const target = { owner: "acme", ownerKind: "organization" as const, number: 1 };
const projectKey = "acme:1";
function board() {
  return boardSchema.parse({
    id: "p",
    title: "Project",
    number: 1,
    url: "https://github.com/orgs/acme/projects/1",
    closed: false,
    description: null,
    viewerCanUpdate: true,
    statusField: null,
    singleSelectFields: [],
    fields: [
      { id: "date", name: "Due", dataType: "DATE" },
      {
        id: "status",
        name: "Status",
        dataType: "SINGLE_SELECT",
        options: [{ id: "todo", name: "Todo" }],
      },
    ],
    dateFields: [{ id: "date", name: "Due" }],
    items: [
      {
        itemId: "i",
        contentId: "issue",
        kind: "Issue",
        number: 1,
        title: "Task",
        body: "Body",
        url: "https://github.com/acme/repo/issues/1",
        repository: "acme/repo",
        reference: "acme/repo #1",
        state: "OPEN",
        isDraft: false,
        author: "me",
        assignees: [],
        labels: [],
        milestone: null,
        issueType: null,
        updatedAt: null,
        singleSelect: {},
        numbers: {},
        text: {},
        viewerCanUpdate: true,
        warnings: [],
      },
    ],
    warnings: [],
  });
}
async function setup(
  t: TestContext,
  overrides: Partial<typeof github> = {},
  configured = true,
) {
  const writes: string[] = [];
  const fake = {
    ...github,
    fetchViewerLogin: async () => "me",
    fetchProjectBoard: async () => board(),
    resolveOwnerKind: async () => "organization" as const,
    listProjects: async () => [],
    fetchItemDetail: async () => ({
      contentId: "issue",
      body: "Body",
      comments: [],
      commentsHasMore: false,
      commentsCursor: null,
      viewerCanUpdate: true,
      viewerCanComment: true,
      linkedPullRequests: [],
      warnings: [],
    }),
    updateContent: async () => {
      writes.push("content");
    },
    setAssignees: async () => {
      writes.push("assignees");
    },
    setProjectField: async () => {
      writes.push("field");
    },
    addComment: async () => {
      writes.push("comment");
      return {};
    },
    createProjectTask: async () => {
      writes.push("create");
      return {
        itemId: "new",
        contentId: "new-issue",
        url: "https://github.com/acme/repo/issues/2",
      };
    },
    ...overrides,
  };
  const host = createFakePluginHost({
    settings: configured
      ? {
          projectUrls: "https://github.com/orgs/acme/projects/1",
          refreshMinutes: 0,
        }
      : { refreshMinutes: 0 },
  });
  t.after(() => host.harness.dispose());
  await createPlugin(fake)(host.bb);
  return {
    ...host,
    writes,
    github: fake,
    rpc: (method: string, input: unknown = null) =>
      host.harness.callRpc(method, input) as Promise<any>,
  };
}
test("initial workspace and CLI are read only", async (t) => {
  const h = await setup(t, {}, false);
  const result = await h.rpc("workspace_get");
  assert.equal(result.configured, false);
  assert.deepEqual(result.projects, []);
  assert.equal(result.viewerLogin, "me");
  assert.equal(h.harness.registrations.cli?.name, "github-projects");
  assert.equal((await h.harness.runCli(["status", "--json"])).exitCode, 0);
  assert.deepEqual(h.writes, []);
});
test("configure deduplicates multiple project targets and persists through reload", async (t) => {
  const h = await setup(t, {}, false);
  const result = await h.rpc("configure", {
    projects: [
      target,
      { ...target, owner: "ACME" },
      { owner: "me", ownerKind: "user", number: 2 },
    ],
    defaultRepository: " acme/repo ",
  });
  assert.equal(result.projects.length, 2);
  assert.equal(result.defaultRepository, "acme/repo");
  const reloaded = await h.harness.reload(createPlugin(h.github));
  t.after(() => reloaded.harness.dispose());
  const again = (await reloaded.harness.callRpc("workspace_get", null)) as any;
  assert.equal(again.projects.length, 2);
  assert.equal(again.defaultRepository, "acme/repo");
  assert.deepEqual(h.writes, []);
});
test("rejects nonmember projects and items before any mutation", async (t) => {
  const h = await setup(t);
  await assert.rejects(
    h.rpc("item_update", { projectKey: "other:1", itemId: "i", title: "bad" }),
  );
  await assert.rejects(
    h.rpc("item_update", { projectKey, itemId: "foreign-item", title: "bad" }),
  );
  assert.deepEqual(h.writes, []);
});
test("validates all fields before content write and respects separate project permission", async (t) => {
  const value = board();
  const h = await setup(t, { fetchProjectBoard: async () => value });
  await assert.rejects(
    h.rpc("item_update", {
      projectKey,
      itemId: "i",
      title: "new",
      fields: [
        { fieldId: "status", value: { singleSelectOptionId: "foreign" } },
      ],
    }),
  );
  assert.deepEqual(h.writes, []);
  value.viewerCanUpdate = false;
  await h.rpc("workspace_get", { refresh: true });
  await assert.rejects(
    h.rpc("item_update", {
      projectKey,
      itemId: "i",
      fields: [{ fieldId: "status", value: { singleSelectOptionId: "todo" } }],
    }),
  );
  const content = await h.rpc("item_update", {
    projectKey,
    itemId: "i",
    title: "new",
  });
  assert.equal(content.ok, true);
  assert.deepEqual(h.writes, ["content"]);
});
test("preserves cached board as stale on failed refresh", async (t) => {
  let failed = false;
  const h = await setup(t, {
    fetchProjectBoard: async () => {
      if (failed) throw new Error("offline");
      return board();
    },
  });
  const initial = await h.rpc("workspace_get");
  failed = true;
  const refreshed = await h.rpc("workspace_get", { refresh: true });
  assert.equal(refreshed.projects[0].board.title, "Project");
  assert.equal(refreshed.projects[0].stale, true);
  assert.match(refreshed.projects[0].problem, /offline/);
  assert.equal(refreshed.projects[0].fetchedAt, initial.projects[0].fetchedAt);
  assert.deepEqual(h.writes, []);
});
test("reports committed content with warning if assignment step fails", async (t) => {
  let committed = 0;
  const h = await setup(t, {
    updateContent: async () => {
      committed++;
    },
    setAssignees: async () => {
      throw new Error("assignment forbidden");
    },
  });
  const result = await h.rpc("item_update", {
    projectKey,
    itemId: "i",
    title: "new",
    assignees: ["me"],
  });
  assert.equal(committed, 1);
  assert.equal(result.ok, true);
  assert.match(result.warning, /assignment forbidden/);
});
test("preserves created issue URL when project attachment failed", async (t) => {
  const url = "https://github.com/acme/repo/issues/77";
  const h = await setup(t, {
    createProjectTask: async () => ({
      itemId: null,
      contentId: "issue77",
      url,
      warning: "Created issue; attachment failed; do not retry creation",
    }),
  });
  const result = await h.rpc("item_create", {
    projectKey,
    title: "new",
    body: "",
    assignees: [],
    repository: "acme/repo",
  });
  assert.equal(result.ok, true);
  assert.equal(result.url, url);
  assert.equal(result.itemId, null);
  assert.match(result.warning, /attachment failed/);
});
test("comment permission and draft restriction prevent posting", async (t) => {
  const value = board();
  let canComment = false;
  const h = await setup(t, {
    fetchProjectBoard: async () => value,
    fetchItemDetail: async () => ({
      contentId: "issue",
      body: "",
      comments: [],
      commentsHasMore: false,
      commentsCursor: null,
      viewerCanUpdate: true,
      viewerCanComment: canComment,
      linkedPullRequests: [],
      warnings: [],
    }),
  });
  await assert.rejects(
    h.rpc("comment_add", { projectKey, itemId: "i", body: "Hi" }),
  );
  canComment = true;
  value.items[0].kind = "DraftIssue";
  await h.rpc("workspace_get", { refresh: true });
  await assert.rejects(
    h.rpc("comment_add", { projectKey, itemId: "i", body: "Hi" }),
  );
  assert.deepEqual(h.writes, []);
});

test('credential change never exposes boards cached under the previous token', async (t) => {
  let offline = false;
  const h = await setup(t, {
    fetchProjectBoard: async () => { if (offline) throw new Error('new token denied'); return board(); },
  });
  assert.ok((await h.rpc('workspace_get')).projects[0].board);
  offline = true;
  await h.harness.behavior.setSettings({ tokenFile: '/tmp/test-only-token-file' });
  const result = await h.rpc('workspace_get');
  assert.equal(result.projects[0].board, null);
  assert.match(result.projects[0].problem, /new token denied/);
});

test('successful write stays successful when its follow-up refresh fails', async (t) => {
  let offline = false;
  let committed = 0;
  const h = await setup(t, {
    fetchProjectBoard: async () => { if (offline) throw new Error('offline after commit'); return board(); },
    updateContent: async () => { committed++; offline = true; },
  });
  const result = await h.rpc('item_update', { projectKey, itemId: 'i', title: 'Saved title' });
  assert.equal(result.ok, true);
  assert.equal(committed, 1);
  assert.match(result.warning, /offline after commit/);
});

test('creation prevalidates all custom fields and duplicate IDs before any GitHub write', async t => {
  const value = board();
  value.fields.push({ id: 'title', name: 'Title', dataType: 'TITLE' });
  const h = await setup(t, { fetchProjectBoard: async () => value });
  const input = { projectKey, title: 'new', body: '', assignees: [], repository: null };
  for (const fields of [
    [{ fieldId: 'foreign', value: null }],
    [{ fieldId: 'title', value: null }],
    [{ fieldId: 'status', value: { number: 1 } }],
    [{ fieldId: 'status', value: { singleSelectOptionId: 'todo', text: 'extra' } }],
    [{ fieldId: 'status', value: null }, { fieldId: 'status', value: null }],
  ]) await assert.rejects(h.rpc('item_create', { ...input, fields }));
  assert.deepEqual(h.writes, []);
});

test('creation applies supported field values after creating the project item', async t => {
  const value = board();
  value.fields.push({ id: 'text', name: 'Notes', dataType: 'TEXT' }, { id: 'number', name: 'Estimate', dataType: 'NUMBER' });
  const sequence: unknown[] = [];
  const h = await setup(t, { fetchProjectBoard: async () => value,
    createProjectTask: async () => { sequence.push('create'); return { itemId: 'created-item', contentId: 'created-draft', url: null }; },
    setProjectField: async (projectId, itemId, fieldId, fieldValue) => { sequence.push({ projectId, itemId, fieldId, value: fieldValue }); },
  });
  const fields = [{ fieldId: 'status', value: { singleSelectOptionId: 'todo' } }, { fieldId: 'date', value: { date: '2028-02-29' } }, { fieldId: 'text', value: { text: 'Notes' } }, { fieldId: 'number', value: { number: -1.25 } }];
  const result = await h.rpc('item_create', { projectKey, title: 'new', body: '', assignees: [], repository: null, fields });
  assert.equal(result.ok, true); assert.equal(result.itemId, 'created-item'); assert.equal(result.warning, null);
  assert.deepEqual(sequence, ['create', ...fields.map(field => ({ projectId: 'p', itemId: 'created-item', ...field }))]);
});

test('post-creation field failure retains created item and URL with partial-success warning', async t => {
  let saves = 0; let creates = 0;
  const url = 'https://github.com/acme/repo/issues/45';
  const h = await setup(t, { createProjectTask: async () => { creates++; return { itemId: 'created', contentId: 'issue45', url }; },
    setProjectField: async () => { if (++saves === 2) throw new Error('field denied'); },
  });
  const result = await h.rpc('item_create', { projectKey, title: 'new', body: '', assignees: [], repository: 'acme/repo', fields: [{ fieldId: 'status', value: { singleSelectOptionId: 'todo' } }, { fieldId: 'date', value: null }] });
  assert.equal(result.ok, true); assert.equal(result.itemId, 'created'); assert.equal(result.url, url);
  assert.match(result.warning, /field denied/); assert.match(result.warning, /\(1\)/); assert.match(result.warning, /Не создавайте/);
  assert.doesNotMatch(result.message, /не добавлена/); assert.equal(creates, 1); assert.equal(saves, 2);
});

test('failed project attachment skips field writes and preserves original recovery result', async t => {
  let saves = 0;
  const h = await setup(t, { createProjectTask: async () => ({ itemId: null, contentId: 'issue', url: 'https://github.com/acme/repo/issues/99', warning: 'attachment failed' }), setProjectField: async () => { saves++; } });
  const result = await h.rpc('item_create', { projectKey, title: 'new', body: '', assignees: [], repository: 'acme/repo', fields: [{ fieldId: 'date', value: null }] });
  assert.equal(result.ok, true); assert.equal(result.itemId, null); assert.match(result.warning, /attachment failed/); assert.equal(saves, 0);
});

test('creation rejects disconnected and non-writable projects before creating tasks', async t => {
  const value = board(); value.viewerCanUpdate = false;
  const h = await setup(t, { fetchProjectBoard: async () => value });
  const input = { projectKey, title: 'new', body: '', assignees: [], repository: null, fields: [{ fieldId: 'date', value: null }] };
  await assert.rejects(h.rpc('item_create', input));
  await assert.rejects(h.rpc('item_create', { ...input, projectKey: 'foreign:1' }));
  assert.deepEqual(h.writes, []);
});

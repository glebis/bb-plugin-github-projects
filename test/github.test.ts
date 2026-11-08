import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listProjects,
  fetchProjectItems,
  fetchProjectFields,
  nextCursor,
} from "../src/github/projects.js";
import {
  setProjectField,
  setAssignees,
  createProjectTask,
  updateContent,
} from "../src/github/mutations.js";
import { fetchItemDetail } from "../src/github/detail.js";
const info = (hasNextPage = false, endCursor: string | null = null) => ({
  hasNextPage,
  endCursor,
});
test("projects paginate with explicit cursor and reject a missing cursor", async () => {
  const cursors: unknown[] = [];
  const projects = await listProjects("user", "me", {
    graphql: async (_, vars) => {
      cursors.push(vars.cursor);
      return {
        user: {
          projectsV2: {
            nodes: [
              {
                id: String(cursors.length),
                title: "P",
                number: 1,
                url: "https://example.test",
                closed: false,
              },
            ],
            pageInfo: info(cursors.length === 1, "next"),
          },
        },
      };
    },
  });
  assert.equal(projects.length, 2);
  assert.deepEqual(cursors, [null, "next"]);
  assert.throws(() => nextCursor(info(true), null), /cursor/);
  assert.throws(() => nextCursor(info(true, "same"), "same"), /cursor/);
});
test("items preserve full repository, body, permissions and expose nested truncation", async () => {
  const items = await fetchProjectItems(
    { login: "me", ownerKind: "user", number: 1 },
    {
      graphql: async () => ({
        user: {
          projectV2: {
            items: {
              pageInfo: info(),
              nodes: [
                {
                  id: "item",
                  isArchived: false,
                  type: "ISSUE",
                  fieldValues: { nodes: [], pageInfo: info(true, "next") },
                  content: {
                    __typename: "Issue",
                    id: "issue",
                    title: "Task",
                    body: "Body",
                    viewerCanUpdate: true,
                    repository: { nameWithOwner: "org/repo" },
                    assignees: {
                      nodes: [{ login: "a" }],
                      pageInfo: info(true, "next"),
                    },
                    labels: { nodes: [], pageInfo: info() },
                  },
                },
              ],
            },
          },
        },
      }),
    },
  );
  assert.equal(items[0].repository, "org/repo");
  assert.equal(items[0].body, "Body");
  assert.equal(items[0].contentId, "issue");
  assert.equal(items[0].viewerCanUpdate, true);
  assert.equal(items[0].warnings.length, 2);
});
test("clear uses explicit clear mutation; assignment clearing sends empty array; draft update uses draftIssueId", async () => {
  const calls: any[] = [];
  const options = {
    graphql: async (q: string, v: any) => {
      calls.push([q, v]);
      return {
        clearProjectV2ItemFieldValue: {},
        updateIssue: {},
        updateProjectV2DraftIssue: {},
      };
    },
  };
  await setProjectField("p", "i", "f", null, options);
  await setAssignees("issue", "Issue", [], options);
  await updateContent("draft", "DraftIssue", { body: "x" }, options);
  assert.match(calls[0][0], /ClearProjectV2ItemFieldValueInput/);
  assert.deepEqual(calls[1][1].input.assigneeIds, []);
  assert.equal(calls[2][1].input.draftIssueId, "draft");
});
test("issue creation partial success returns recoverable URL and never recreates issue", async () => {
  let created = 0;
  const result = await createProjectTask("p", "Title", "Body", [], "org/repo", {
    graphql: async (q) => {
      if (q.includes("query")) return { repository: { id: "r" } };
      if (q.includes("createIssue")) {
        created++;
        return {
          createIssue: {
            issue: { id: "issue", url: "https://github.com/org/repo/issues/1" },
          },
        };
      }
      throw new Error("forbidden");
    },
  });
  assert.equal(created, 1);
  assert.equal(result.itemId, null);
  assert.match(result.warning!, /do not create it again/);
  assert.ok(result.url);
});
test("detail comment paging exposes cursor and deleted author", async () => {
  const detail = await fetchItemDetail(
    "issue",
    {
      graphql: async (_, vars) => {
        assert.equal(vars.after, "previous");
        return {
          node: {
            __typename: "Issue",
            body: "body",
            viewerCanUpdate: true,
            viewerCanComment: true,
            comments: {
              nodes: [
                {
                  id: "c",
                  body: "hello",
                  url: "u",
                  createdAt: "now",
                  author: null,
                },
              ],
              pageInfo: info(true, "next"),
            },
          },
        };
      },
    },
    "previous",
  );
  assert.equal(detail.commentsCursor, "next");
  assert.equal(detail.commentsHasMore, true);
  assert.equal(detail.comments[0].author, null);
});

test("field definitions paginate and retain dates/options/project capability", async () => {
  let page = 0;
  const board = await fetchProjectFields(
    { login: "me", ownerKind: "user", number: 1 },
    {
      graphql: async (_, vars) => {
        page++;
        assert.equal(vars.cursor, page === 1 ? null : "fields-next");
        return {
          user: {
            projectV2: {
              id: "p",
              title: "P",
              number: 1,
              url: "u",
              closed: false,
              viewerCanUpdate: true,
              fields: {
                nodes:
                  page === 1
                    ? [
                        {
                          __typename: "ProjectV2SingleSelectField",
                          id: "s",
                          name: "Status",
                          dataType: "SINGLE_SELECT",
                          options: [{ id: "o", name: "Todo" }],
                        },
                      ]
                    : [
                        {
                          __typename: "ProjectV2Field",
                          id: "d",
                          name: "Due",
                          dataType: "DATE",
                        },
                      ],
                pageInfo: info(page === 1, "fields-next"),
              },
            },
          },
        };
      },
    },
  );
  assert.equal(board.fields.length, 2);
  assert.equal(board.dateFields[0].name, "Due");
  assert.equal(board.viewerCanUpdate, true);
  assert.equal(board.statusField?.options[0].name, "Todo");
});
test("draft permission derives from its single project", async () => {
  const detail = await fetchItemDetail("d", {
    graphql: async () => ({
      node: {
        __typename: "DraftIssue",
        body: "draft",
        projectsV2: { nodes: [{ viewerCanUpdate: true }] },
      },
    }),
  });
  assert.equal(detail.viewerCanUpdate, true);
  assert.equal(detail.viewerCanComment, false);
  assert.deepEqual(detail.comments, []);
});

test("CLI stderr scope errors classify into actionable message preserving diagnostics", async () => {
  const {
    classifyGhError,
    GhProjectScopeError,
    GhTokenFileError,
    GhMissingError,
    GhError,
  } = await import("../src/github/cli.js");
  for (const stderr of [
    "GraphQL: Your token has not been granted the required scopes to execute this query. Required scopes: ['read:project']",
    "Resource not accessible by integration",
    "insufficient scope",
    "Required scopes: project",
  ]) {
    const original = Object.assign(
      new Error("Command failed: gh api graphql --input -"),
      { code: 1, stderr },
    );
    const result = classifyGhError(original);
    assert.ok(result instanceof GhProjectScopeError);
    assert.equal(result.stderr, stderr);
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /read:project/);
    assert.match(result.message, /gh auth refresh -h github.com -s project/);
    assert.match(result.message, /SSO/);
  }
  const tokenError = new GhTokenFileError("/nonsecret/example", "no such file");
  assert.equal(classifyGhError(tokenError), tokenError);
  assert.ok(
    classifyGhError(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    ) instanceof GhMissingError,
  );
  const generic = classifyGhError(
    Object.assign(new Error("failed"), {
      code: 7,
      stderr: "network unavailable",
    }),
  );
  assert.ok(generic instanceof GhError);
  assert.equal(generic.exitCode, 7);
  assert.equal(generic.message, "network unavailable");
});

test("detail uses real Issue/PR schema and treats commenting as allowed-to-attempt", async () => {
  const { fetchItemDetail } = await import("../src/github/detail.js");
  for (const [kind, locked, permission, archived, expected] of [
    ["Issue", false, "READ", false, true],
    ["PullRequest", false, null, false, true],
    ["Issue", true, "READ", false, false],
    ["Issue", true, "WRITE", false, true],
    ["PullRequest", true, "MAINTAIN", false, true],
    ["Issue", false, "ADMIN", true, false],
  ] as const) {
    const detail = await fetchItemDetail("item", {
      graphql: async (query) => {
        assert.doesNotMatch(query, /viewerCanComment/);
        assert.match(query, /locked/);
        assert.match(query, /viewerPermission/);
        return {
          viewer: { login: "me" },
          node: {
            __typename: kind,
            body: "",
            locked,
            repository: {
              viewerPermission: permission,
              isArchived: archived,
              isDisabled: false,
            },
          },
        };
      },
    });
    assert.equal(
      detail.viewerCanComment,
      expected,
      `${kind} locked=${locked} permission=${permission} archived=${archived}`,
    );
  }
});


test("board comment counts preserve Issue/PR totals while drafts and absent counts stay unknown", async () => {
  const { fetchProjectItems } = await import("../src/github/projects.js");
  const items = await fetchProjectItems({ login: "me", ownerKind: "user", number: 1 }, { graphql: async query => {
    assert.equal((query.match(/comments \{ totalCount \}/g) ?? []).length, 2);
    const content = [
      { __typename: "Issue", comments: { totalCount: 12 } },
      { __typename: "PullRequest", comments: { totalCount: 0 } },
      { __typename: "DraftIssue" },
      { __typename: "Issue" },
      null,
    ];
    return { user: { projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: content.map((c, i) => ({ id: `i${i}`, type: "ISSUE", isArchived: false, fieldValues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] }, content: c })) } } } };
  } });
  assert.deepEqual(items.map(item => item.commentCount), [12, 0, null, null, null]);
});

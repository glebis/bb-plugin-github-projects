import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestCommentUsers } from "../src/github/comment-features.js";
test("mention suggestions keep query in variables, cap results and parse nullable user metadata", async () => {
  const result = await suggestCommentUsers("acme/repo", '@a" } mutation {', {
    graphql: async (query, variables) => {
      assert.match(query, /assignableUsers\(first: 20, query: \$query\)/);
      assert.doesNotMatch(query, /mutation/);
      assert.deepEqual(variables, {
        owner: "acme",
        name: "repo",
        query: 'a" } mutation {',
      });
      return {
        repository: {
          assignableUsers: {
            nodes: [
              null,
              {
                login: "alice",
                name: null,
                avatarUrl: "https://avatars.githubusercontent.com/u/1",
              },
            ],
          },
        },
      };
    },
  });
  assert.deepEqual(
    result.map((u) => u.login),
    ["alice"],
  );
});
test("mention suggestions reject unavailable repositories and invalid response shapes", async () => {
  await assert.rejects(
    suggestCommentUsers("acme/repo", "a", {
      graphql: async () => ({ repository: null }),
    }),
  );
  await assert.rejects(
    suggestCommentUsers("acme/repo", "a", {
      graphql: async () => ({
        repository: { assignableUsers: { nodes: [{ login: 5 }] } },
      }),
    }),
  );
  await assert.rejects(
    suggestCommentUsers("https://github.com/acme/repo", "a", {
      graphql: async () => {
        throw new Error("should not call");
      },
    }),
  );
});

import { z } from "zod";
import { graphql, type GhRunOptions } from "./cli.js";
const suggestionSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type CommentUserSuggestion = z.infer<typeof suggestionSchema>;
/** Bounded autocomplete candidates; assignable users are suggestions, not all mentionable users. */
export async function suggestCommentUsers(
  repository: string,
  query: string,
  options: GhRunOptions = {},
): Promise<CommentUserSuggestion[]> {
  const parts = repository.split("/");
  if (parts.length !== 2 || !parts.every((p) => /^[a-z\d._-]+$/i.test(p)))
    throw new Error("Укажите репозиторий в формате владелец/название.");
  const text = query.trim().replace(/^@/, "");
  if (text.length > 100) throw new Error("Слишком длинный поисковый запрос.");
  const data = await graphql(
    `
      query ($owner: String!, $name: String!, $query: String!) {
        repository(owner: $owner, name: $name) {
          assignableUsers(first: 20, query: $query) {
            nodes {
              login
              name
              avatarUrl
            }
          }
        }
      }
    `,
    { owner: parts[0], name: parts[1], query: text },
    options,
  );
  const result = z
    .object({
      repository: z
        .object({
          assignableUsers: z.object({
            nodes: z.array(suggestionSchema.nullable()),
          }),
        })
        .nullable(),
    })
    .parse(data);
  if (!result.repository)
    throw new Error("Репозиторий недоступен этой учётной записи.");
  return result.repository.assignableUsers.nodes.filter(
    (user): user is CommentUserSuggestion => user !== null,
  );
}

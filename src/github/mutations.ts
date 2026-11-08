import { graphql, type GhRunOptions } from "./cli.js";
type Kind = "Issue" | "PullRequest" | "DraftIssue";
async function mutate(
  name: string,
  type: string,
  input: Record<string, unknown>,
  selection: string,
  options: GhRunOptions,
) {
  const data = (await graphql(
    `mutation($input: ${type}!) { ${name}(input: $input) { ${selection} } }`,
    { input },
    options,
  )) as Record<string, any>;
  if (!data[name]) throw new Error(`GitHub returned no ${name} result`);
  return data[name];
}
export type ProjectFieldValue = {
  singleSelectOptionId?: string;
  date?: string;
  text?: string;
  number?: number;
};
export async function setProjectField(
  projectId: string,
  itemId: string,
  fieldId: string,
  value: ProjectFieldValue | null,
  options: GhRunOptions = {},
) {
  if (value !== null && Object.keys(value).length !== 1)
    throw new Error("Supply exactly one field value");
  const clear = value === null;
  await mutate(
    clear ? "clearProjectV2ItemFieldValue" : "updateProjectV2ItemFieldValue",
    clear
      ? "ClearProjectV2ItemFieldValueInput"
      : "UpdateProjectV2ItemFieldValueInput",
    { projectId, itemId, fieldId, ...(clear ? {} : { value }) },
    "projectV2Item { id }",
    options,
  );
}
export async function updateContent(
  contentId: string,
  kind: Kind,
  patch: { title?: string; body?: string },
  options: GhRunOptions = {},
) {
  const draft = kind === "DraftIssue";
  await mutate(
    draft ? "updateProjectV2DraftIssue" : `update${kind}`,
    draft ? "UpdateProjectV2DraftIssueInput" : `Update${kind}Input`,
    {
      [draft ? "draftIssueId" : kind === "Issue" ? "id" : "pullRequestId"]:
        contentId,
      ...patch,
    },
    draft
      ? "draftIssue { id }"
      : `${kind === "Issue" ? "issue" : "pullRequest"} { id }`,
    options,
  );
}
async function userIds(
  logins: string[],
  options: GhRunOptions,
): Promise<string[]> {
  return Promise.all(
    [...new Set(logins)].map(async (login) => {
      const data = (await graphql(
        "query($login: String!) { user(login: $login) { id } }",
        { login },
        options,
      )) as any;
      if (!data.user?.id) throw new Error(`No GitHub user ${login}`);
      return data.user.id as string;
    }),
  );
}
export async function setAssignees(
  contentId: string,
  kind: Kind,
  logins: string[],
  options: GhRunOptions = {},
) {
  const assigneeIds = await userIds(logins, options);
  if (kind === "DraftIssue") {
    await mutate(
      "updateProjectV2DraftIssue",
      "UpdateProjectV2DraftIssueInput",
      { draftIssueId: contentId, assigneeIds },
      "draftIssue { id }",
      options,
    );
  } else {
    await mutate(
      `update${kind}`,
      `Update${kind}Input`,
      { [kind === "Issue" ? "id" : "pullRequestId"]: contentId, assigneeIds },
      `${kind === "Issue" ? "issue" : "pullRequest"} { id }`,
      options,
    );
  }
}
export async function addComment(
  contentId: string,
  body: string,
  options: GhRunOptions = {},
) {
  return mutate(
    "addComment",
    "AddCommentInput",
    { subjectId: contentId, body },
    "commentEdge { node { id url } }",
    options,
  );
}
export async function createProjectTask(
  projectId: string,
  title: string,
  body: string,
  assigneeLogins: string[],
  repository: string | null,
  options: GhRunOptions = {},
): Promise<{
  itemId: string | null;
  contentId: string;
  url: string | null;
  warning?: string;
}> {
  const assigneeIds = await userIds(assigneeLogins, options);
  if (!repository) {
    const result = await mutate(
      "addProjectV2DraftIssue",
      "AddProjectV2DraftIssueInput",
      { projectId, title, body, assigneeIds },
      "projectItem { id content { ... on DraftIssue { id } } }",
      options,
    );
    return {
      itemId: result.projectItem.id,
      contentId: result.projectItem.content.id,
      url: null,
    };
  }
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some((p) => !p))
    throw new Error("Repository must be owner/name");
  const data = (await graphql(
    "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }",
    { owner: parts[0], name: parts[1] },
    options,
  )) as any;
  if (!data.repository?.id) throw new Error("Repository not visible");
  const { issue } = await mutate(
    "createIssue",
    "CreateIssueInput",
    { repositoryId: data.repository.id, title, body, assigneeIds },
    "issue { id url }",
    options,
  );
  try {
    const result = await mutate(
      "addProjectV2ItemById",
      "AddProjectV2ItemByIdInput",
      { projectId, contentId: issue.id },
      "item { id }",
      options,
    );
    return { itemId: result.item.id, contentId: issue.id, url: issue.url };
  } catch (error) {
    return {
      itemId: null,
      contentId: issue.id,
      url: issue.url,
      warning: `Issue was created but could not be added to the project. Open the issue and add it manually; do not create it again. ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

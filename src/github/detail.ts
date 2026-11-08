import { graphql, type GhRunOptions } from "./cli.js";
export interface ItemDetail {
  contentId: string;
  body: string;
  comments: {
    id: string;
    body: string;
    url: string;
    createdAt: string;
    author: string | null;
  }[];
  commentsHasMore: boolean;
  commentsCursor: string | null;
  viewerCanUpdate: boolean;
  /** Allowed to attempt; GitHub still enforces token scopes, interaction limits and moderation. */
  viewerCanComment: boolean;
  linkedPullRequests: {
    id: string;
    number: number;
    title: string;
    url: string;
    repository: string;
  }[];
  warnings: string[];
}
/** Fetch a comment page (50 comments), supplying the prior commentsCursor as after. */
export async function fetchItemDetail(
  contentId: string,
  options: GhRunOptions = {},
  after: string | null = null,
): Promise<ItemDetail> {
  const data = (await graphql(
    `
      query ($id: ID!, $after: String) {
        viewer {
          login
        }
        node(id: $id) {
          __typename
          ... on DraftIssue {
            id
            body
            projectsV2(first: 1) {
              nodes {
                viewerCanUpdate
              }
            }
          }
          ... on Issue {
            id
            body
            viewerCanUpdate
            locked
            repository {
              viewerPermission
              isArchived
              isDisabled
            }
            comments(first: 50, after: $after) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                body
                url
                createdAt
                author {
                  login
                }
              }
            }
            closedByPullRequestsReferences(first: 100) {
              pageInfo {
                hasNextPage
              }
              nodes {
                id
                number
                title
                url
                repository {
                  nameWithOwner
                }
              }
            }
          }
          ... on PullRequest {
            id
            body
            viewerCanUpdate
            locked
            repository {
              viewerPermission
              isArchived
              isDisabled
            }
            comments(first: 50, after: $after) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                body
                url
                createdAt
                author {
                  login
                }
              }
            }
          }
        }
      }
    `,
    { id: contentId, after },
    options,
  )) as any;
  const node = data.node;
  if (
    !node ||
    !["Issue", "PullRequest", "DraftIssue"].includes(node.__typename)
  )
    throw new Error("Task content is unavailable");
  const info = node.comments?.pageInfo;
  if (info?.hasNextPage && !info.endCursor)
    throw new Error("GitHub omitted the next comments cursor");
  return {
    contentId,
    body: node.body ?? "",
    comments: (node.comments?.nodes ?? []).filter(Boolean).map((c: any) => ({
      id: c.id,
      body: c.body,
      url: c.url,
      createdAt: c.createdAt,
      author: c.author?.login ?? null,
    })),
    commentsHasMore: info?.hasNextPage ?? false,
    commentsCursor: info?.endCursor ?? null,
    viewerCanUpdate:
      node.viewerCanUpdate ??
      node.projectsV2?.nodes[0]?.viewerCanUpdate ??
      false,
    // GitHub Issue/PullRequest expose no viewerCanComment field. This capability
    // means allowed to attempt: signed-in readers can comment on unlocked threads;
    // locked threads require write access. Token scopes and moderation are enforced
    // by addComment, and cannot be authoritatively preflighted through this schema.
    viewerCanComment:
      node.__typename !== "DraftIssue" &&
      Boolean(data.viewer?.login) &&
      !node.repository?.isArchived &&
      !node.repository?.isDisabled &&
      (node.locked === false ||
        ["WRITE", "MAINTAIN", "ADMIN"].includes(
          node.repository?.viewerPermission,
        )),
    linkedPullRequests: (node.closedByPullRequestsReferences?.nodes ?? [])
      .filter(Boolean)
      .map((pr: any) => ({
        id: pr.id,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        repository: pr.repository.nameWithOwner,
      })),
    warnings: node.closedByPullRequestsReferences?.pageInfo.hasNextPage
      ? ["Linked pull requests incomplete"]
      : [],
  };
}

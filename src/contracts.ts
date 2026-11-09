import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const targetSchema = z.object({
  owner: z
    .string()
    .trim()
    .regex(/^[a-z\d](?:[a-z\d-]{0,38})$/i),
  number: z.number().int().positive(),
  ownerKind: z.enum(["organization", "user"]),
});
export type ProjectTarget = z.infer<typeof targetSchema>;
export const optionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  color: z.string().nullish(),
});
export const selectFieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  options: z.array(optionSchema),
});
export const itemSchema = z.object({
  itemId: z.string(),
  contentId: z.string().nullable(),
  kind: z.enum(["Issue", "PullRequest", "DraftIssue", "Unknown"]),
  number: z.number().nullable(),
  title: z.string(),
  body: z.string(),
  url: z.string().nullable(),
  repository: z.string().nullable(),
  reference: z.string().nullable(),
  state: z.string().nullable(),
  isDraft: z.boolean(),
  author: z.string().nullable(),
  assignees: z.array(
    z.object({ login: z.string(), avatarUrl: z.string().nullable() }),
  ),
  labels: z.array(z.object({ name: z.string(), color: z.string().nullable() })),
  milestone: z.string().nullable(),
  issueType: z.string().nullable(),
  updatedAt: z.string().nullable(),
  singleSelect: z.record(z.string(), z.string()),
  numbers: z.record(z.string(), z.number()),
  text: z.record(z.string(), z.string()),
  viewerCanUpdate: z.boolean(),
  commentCount: z.number().int().nonnegative().nullable().default(null),
  warnings: z.array(z.string()).default([]),
});
export type ProjectItem = z.infer<typeof itemSchema>;
export const boardSchema = z.object({
  id: z.string(),
  title: z.string(),
  number: z.number(),
  url: z.string(),
  closed: z.boolean(),
  description: z.string().nullable(),
  statusField: selectFieldSchema.nullable(),
  singleSelectFields: z.array(selectFieldSchema),
  fields: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      dataType: z.string(),
      options: z.array(optionSchema).optional(),
    }),
  ),
  dateFields: z.array(z.object({ id: z.string(), name: z.string() })),
  items: z.array(itemSchema),
  warnings: z.array(z.string()).default([]),
  viewerCanUpdate: z.boolean().default(false),
});
export type ProjectBoard = z.infer<typeof boardSchema>;
export const snapshotSchema = z.object({
  key: z.string(),
  target: targetSchema,
  board: boardSchema.nullable(),
  fetchedAt: z.string().nullable(),
  stale: z.boolean(),
  problem: z.string().nullable(),
});
export type ProjectSnapshot = z.infer<typeof snapshotSchema>;
export const workspaceSchema = z.object({
  viewerLogin: z.string().nullable(),
  projects: z.array(snapshotSchema),
  configured: z.boolean(),
  defaultRepository: z.string(),
  problem: z.string().nullable(),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const detailSchema = z.object({
  contentId: z.string(),
  body: z.string(),
  warnings: z.array(z.string()).default([]),
  comments: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      url: z.string(),
      createdAt: z.string(),
      author: z.string().nullable(),
    }),
  ),
  commentsHasMore: z.boolean(),
  commentsCursor: z.string().nullable(),
  viewerCanUpdate: z.boolean(),
  viewerCanComment: z.boolean(),
  linkedPullRequests: z.array(
    z.object({
      id: z.string(),
      number: z.number(),
      title: z.string(),
      url: z.string(),
      repository: z.string(),
    }),
  ),
});
export type ItemDetail = z.infer<typeof detailSchema>;
export const fieldValueSchema = z.union([
  z.object({ singleSelectOptionId: z.string().min(1) }).strict(),
  z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ text: z.string().max(1024) }).strict(),
  z.object({ number: z.number().finite() }).strict(),
  z.null(),
]);
export const fieldChangesSchema = z.array(z.object({ fieldId: z.string().min(1), value: fieldValueSchema }).strict()).max(100).refine(
  changes => new Set(changes.map(change => change.fieldId)).size === changes.length,
  "Поле указано несколько раз.",
);
export const mutationResultSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
  warning: z.string().nullable(),
  itemId: z.string().nullable(),
  url: z.string().nullable(),
});
export type MutationResult = z.infer<typeof mutationResultSchema>;
const itemRef = { projectKey: z.string().min(1), itemId: z.string().min(1) };
export const rpcContract = defineRpcContract({
  workspace_get: {
    input: z.object({ refresh: z.boolean().optional() }).nullable(),
    output: workspaceSchema,
  },
  projects_discover: {
    input: z.object({ owner: targetSchema.shape.owner }),
    output: z.object({
      ownerKind: targetSchema.shape.ownerKind,
      projects: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          number: z.number(),
          url: z.string(),
          closed: z.boolean(),
          shortDescription: z.string().nullish(),
          updatedAt: z.string().nullish(),
        }),
      ),
    }),
  },
  configure: {
    input: z.object({
      projects: z.array(targetSchema).max(25),
      defaultRepository: z.string().trim().max(200),
    }),
    output: workspaceSchema,
  },
  item_detail: {
    input: z.object({ ...itemRef, after: z.string().optional() }),
    output: detailSchema,
  },
  item_update: {
    input: z.object({
      ...itemRef,
      title: z.string().trim().min(1).max(1024).optional(),
      body: z.string().max(65536).optional(),
      assignees: z
        .array(z.string().regex(/^[a-z\d-]+$/i))
        .max(10)
        .optional(),
      fields: fieldChangesSchema.optional(),
    }),
    output: mutationResultSchema,
  },
  item_create: {
    input: z.object({
      projectKey: z.string(),
      title: z.string().trim().min(1).max(1024),
      body: z.string().max(65536),
      assignees: z.array(z.string().regex(/^[a-z\d-]+$/i)).max(10),
      repository: z.string().nullable(),
      fields: fieldChangesSchema.optional(),
    }),
    output: mutationResultSchema,
  },
  comment_add: {
    input: z.object({ ...itemRef, body: z.string().trim().min(1).max(65536) }),
    output: mutationResultSchema,
  },
  assignees_list: {
    input: z.object({ projectKey: z.string().min(1), repository: z.string().nullable().optional(), query: z.string().trim().max(80) }),
    output: z.object({ users: z.array(z.object({ login: z.string(), name: z.string().nullable(), avatarUrl: z.string().nullable() })) }),
  },
  comment_users: {
    input: z.object({ ...itemRef, query: z.string().trim().max(80) }),
    output: z.object({
      users: z.array(
        z.object({
          login: z.string(),
          name: z.string().nullable(),
          avatarUrl: z.string().nullable(),
        }),
      ),
    }),
  },
  comment_upload: {
    input: z.object({
      ...itemRef,
      name: z.string().min(1).max(255),
      contentType: z.string().max(100),
      base64: z.string().min(1).max(7_000_000),
    }),
    output: z.object({
      name: z.string(),
      url: z.string().url(),
      markdown: z.string(),
    }),
  },
});

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { setTimeout as delay } from "node:timers/promises";
import * as liveGithub from "./src/github/projects.js";
import { suggestCommentUsers } from "./src/github/comment-features.js";
import { uploadCommentAttachment } from "./src/github/attachments.js";
import type { GhRunOptions } from "./src/github/cli.js";
import {
  rpcContract,
  boardSchema,
  targetSchema,
  type ProjectTarget,
  type ProjectSnapshot,
  type Workspace,
  type MutationResult,
} from "./src/contracts.js";
import {
  parseProjectUrls,
  projectKey,
  projectUrl,
  parseRepository,
  getItem,
  validateFieldChange,
} from "./src/model.js";
export { rpcContract } from "./src/contracts.js";
export type {
  Workspace,
  ProjectSnapshot,
  ProjectItem,
  ItemDetail,
  MutationResult,
} from "./src/contracts.js";

type Github = typeof liveGithub;
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const TTL = 2 * 60_000;

/** Dependency injection exercises real SDK contracts without performing GitHub writes. */
export function createPlugin(
  github: Github = liveGithub,
  commentServices = { suggestCommentUsers, uploadCommentAttachment },
) {
  return async function plugin(bb: BbPluginApi) {
    const settings = bb.settings.define({
      projectUrls: {
        type: "string",
        label: "GitHub Projects",
        description: "Connected project URLs, one per line.",
        experimental_multiline: true,
        default: "",
      },
      defaultRepository: {
        type: "string",
        label: "Default repository for new tasks",
        description:
          "Owner/name. Leave empty to create project drafts.",
        default: "",
      },
      refreshMinutes: {
        type: "number",
        label: "Refresh interval (minutes)",
        description: "0 disables background refresh.",
        default: 15,
      },
      tokenFile: {
        type: "string",
        label: "Token file (optional)",
        description:
          "Server path to a token file instead of the current gh session. Not sent to the interface.",
        default: "",
      },
    });
    const db = bb.storage.database();
    db.exec(
      "CREATE TABLE IF NOT EXISTS projects_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at TEXT NOT NULL)",
    );
    const controller = new AbortController();
    let generation = 0;
    let viewer: { login: string; fetched: number } | null = null;
    const flights = new Map<string, Promise<ProjectSnapshot>>();
    const queues = new Map<string, Promise<unknown>>();
    const config = async () => {
      const value = await settings.get();
      return {
        targets: parseProjectUrls(String(value.projectUrls)),
        repository: parseRepository(String(value.defaultRepository)) ?? "",
        tokenFile: String(value.tokenFile).trim() || null,
        refreshMinutes: Number(value.refreshMinutes),
      };
    };
    const options = async (): Promise<GhRunOptions> => ({
      tokenFile: (await config()).tokenFile,
      signal: controller.signal,
    });
    function cached(target: ProjectTarget): ProjectSnapshot {
      const key = projectKey(target);
      const row = db
        .prepare("SELECT payload, fetched_at FROM projects_cache WHERE key = ?")
        .get(key) as { payload: string; fetched_at: string } | undefined;
      if (row) {
        try {
          return {
            key,
            target,
            board: boardSchema.parse(JSON.parse(row.payload)),
            fetchedAt: row.fetched_at,
            stale: Date.now() - Date.parse(row.fetched_at) > TTL,
            problem: null,
          };
        } catch {
          /* invalid cache is refetched */
        }
      }
      return {
        key,
        target,
        board: null,
        fetchedAt: null,
        stale: true,
        problem: null,
      };
    }
    async function load(
      target: ProjectTarget,
      refresh = false,
    ): Promise<ProjectSnapshot> {
      const old = cached(target);
      if (!refresh && old.board && !old.stale) return old;
      const gen = generation;
      const flightKey = `${gen}/${old.key}`;
      const existing = flights.get(flightKey);
      if (existing) return existing;
      const promise = (async (): Promise<ProjectSnapshot> => {
        try {
          const board = boardSchema.parse(
            await github.fetchProjectBoard(
              {
                ownerKind: target.ownerKind,
                login: target.owner,
                number: target.number,
              },
              await options(),
            ),
          );
          const fetchedAt = new Date().toISOString();
          controller.signal.throwIfAborted();
          if (generation !== gen)
            return {
              ...old,
              stale: true,
              problem: "Настройки изменились. Обновите проекты.",
            };
          db.prepare(
            "INSERT INTO projects_cache(key,payload,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at",
          ).run(old.key, JSON.stringify(board), fetchedAt);
          return {
            key: old.key,
            target,
            board,
            fetchedAt,
            stale: false,
            problem: null,
          };
        } catch (error) {
          return { ...old, stale: true, problem: message(error) };
        }
      })();
      flights.set(flightKey, promise);
      try {
        return await promise;
      } finally {
        flights.delete(flightKey);
      }
    }
    async function workspace(refresh = false): Promise<Workspace> {
      const cfg = await config();
      let problem: string | null = null;
      try {
        if (!viewer || refresh || Date.now() - viewer.fetched > 300_000)
          viewer = {
            login: await github.fetchViewerLogin(await options()),
            fetched: Date.now(),
          };
      } catch (error) {
        problem = message(error);
        viewer = null;
      }
      // Three concurrent project reads keep startup bounded without overwhelming gh.
      const results: ProjectSnapshot[] = new Array(cfg.targets.length);
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, cfg.targets.length) }, async () => {
          while (index < cfg.targets.length) {
            const next = index++;
            results[next] = await load(cfg.targets[next], refresh);
          }
        }),
      );
      return {
        viewerLogin: viewer?.login ?? null,
        projects: results,
        configured: cfg.targets.length > 0,
        defaultRepository: cfg.repository,
        problem,
      };
    }
    async function projectFor(key: string) {
      const cfg = await config();
      const target = cfg.targets.find((target) => projectKey(target) === key);
      if (!target)
        throw new Error("Проект не подключён. Выберите проект в настройках.");
      const snapshot = await load(target);
      if (!snapshot.board || snapshot.problem || snapshot.stale)
        throw new Error(snapshot.problem || "Сначала обновите данные проекта.");
      return snapshot;
    }
    async function itemFor(key: string, itemId: string) {
      const snapshot = await projectFor(key);
      return {
        snapshot,
        board: snapshot.board!,
        item: getItem(snapshot.board!, itemId),
      };
    }
    async function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const previous = queues.get(key) ?? Promise.resolve();
      const pending = previous.catch(() => {}).then(fn);
      queues.set(key, pending);
      try {
        return await pending;
      } finally {
        if (queues.get(key) === pending) queues.delete(key);
      }
    }
    async function afterWrite(
      snapshot: ProjectSnapshot,
      result: Omit<MutationResult, "ok">,
    ): Promise<MutationResult> {
      // A pre-write read must never mark its older contents as freshly fetched.
      generation++;
      let refreshProblem: string | null = null;
      try {
        db.prepare("UPDATE projects_cache SET fetched_at = ?").run(
          "1970-01-01T00:00:00.000Z",
        );
        const fresh = await load(snapshot.target, true);
        refreshProblem = fresh.problem;
        bb.realtime.publish("workspace-changed", { key: snapshot.key });
      } catch (error) {
        refreshProblem = message(error);
      }
      const warning =
        [
          result.warning,
          refreshProblem
            ? `Изменение выполнено в GitHub, но обновить список не удалось: ${refreshProblem}. Не повторяйте действие, обновите список.`
            : null,
        ]
          .filter(Boolean)
          .join("\n") || null;
      return { ...result, ok: true, warning };
    }
    bb.rpc.register(rpcContract, {
      workspace_get: async (input) => workspace(input?.refresh ?? false),
      projects_discover: async ({ owner }) => {
        const opts = await options();
        const ownerKind = await github.resolveOwnerKind(owner, opts);
        return {
          ownerKind,
          projects: await github.listProjects(ownerKind, owner, opts),
        };
      },
      configure: async ({ projects, defaultRepository }) => {
        const unique = [
          ...new Map(
            projects.map((target) => {
              const parsed = targetSchema.parse(target);
              return [projectKey(parsed), parsed];
            }),
          ).values(),
        ];
        const repository = parseRepository(defaultRepository) ?? "";
        await settings.experimental_set({
          projectUrls: unique.map(projectUrl).join("\n"),
          defaultRepository: repository,
        });
        bb.realtime.publish("workspace-changed", { configuration: true });
        return workspace();
      },
      item_detail: async ({ projectKey: key, itemId, after }) => {
        const { item } = await itemFor(key, itemId);
        return github.fetchItemDetail(
          item.contentId!,
          await options(),
          after ?? null,
        );
      },
      item_update: async (input) =>
        serialize(`item/${input.projectKey}/${input.itemId}`, async () => {
          const { snapshot, board, item } = await itemFor(
            input.projectKey,
            input.itemId,
          );
          if (
            input.title === undefined &&
            input.body === undefined &&
            input.assignees === undefined &&
            !input.fields?.length
          )
            throw new Error("Нет изменений для сохранения.");
          const contentChange =
            input.title !== undefined ||
            input.body !== undefined ||
            input.assignees !== undefined;
          if (contentChange && !item.viewerCanUpdate)
            throw new Error(
              "У текущей учётной записи нет прав изменять эту задачу.",
            );
          if (input.fields?.length && !board.viewerCanUpdate)
            throw new Error(
              "У текущей учётной записи нет прав изменять поля проекта.",
            );
          if (
            input.assignees &&
            item.warnings.some((warning) => /assignees/i.test(warning))
          )
            throw new Error(
              "Список исполнителей загружен не полностью. Измените назначение в GitHub.",
            );
          for (const field of input.fields ?? [])
            validateFieldChange(board, field.fieldId, field.value);
          const opts = await options();
          let committed = 0;
          let warning: string | null = null;
          try {
            if (input.title !== undefined || input.body !== undefined) {
              await github.updateContent(
                item.contentId!,
                item.kind as "Issue" | "PullRequest" | "DraftIssue",
                {
                  ...(input.title !== undefined ? { title: input.title } : {}),
                  ...(input.body !== undefined ? { body: input.body } : {}),
                },
                opts,
              );
              committed++;
            }
            if (input.assignees !== undefined) {
              await github.setAssignees(
                item.contentId!,
                item.kind as "Issue" | "PullRequest" | "DraftIssue",
                input.assignees,
                opts,
              );
              committed++;
            }
            for (const field of input.fields ?? []) {
              await github.setProjectField(
                board.id,
                item.itemId,
                field.fieldId,
                field.value,
                opts,
              );
              committed++;
            }
          } catch (error) {
            if (!committed) throw error;
            warning = `Сохранена часть изменений (${committed}). Остальные не выполнены: ${message(error)}. Сверьте задачу перед повторным сохранением.`;
          }
          return afterWrite(snapshot, {
            message: warning
              ? "Сохранена часть изменений"
              : "Изменения сохранены в GitHub",
            warning,
            itemId: item.itemId,
            url: item.url,
          });
        }),
      item_create: async (input) =>
        serialize(`create/${input.projectKey}`, async () => {
          const snapshot = await projectFor(input.projectKey);
          if (!snapshot.board!.viewerCanUpdate)
            throw new Error(
              "У текущей учётной записи нет прав добавлять задачи в проект.",
            );
          const result = await github.createProjectTask(
            snapshot.board!.id,
            input.title,
            input.body,
            input.assignees,
            parseRepository(input.repository),
            await options(),
          );
          return afterWrite(snapshot, {
            message: result.warning
              ? "Задача создана, но не добавлена в проект"
              : "Задача создана в GitHub",
            warning: result.warning ?? null,
            itemId: result.itemId,
            url: result.url,
          });
        }),
      comment_add: async ({ projectKey: key, itemId, body }) =>
        serialize(`item/${key}/${itemId}`, async () => {
          const { snapshot, item } = await itemFor(key, itemId);
          if (item.kind === "DraftIssue")
            throw new Error(
              "У черновиков GitHub нет обсуждения. Создайте задачу в репозитории.",
            );
          const opts = await options();
          const detail = await github.fetchItemDetail(item.contentId!, opts);
          if (!detail.viewerCanComment)
            throw new Error(
              "У текущей учётной записи нет прав комментировать эту задачу.",
            );
          await github.addComment(item.contentId!, body, opts);
          return afterWrite(snapshot, {
            message: "Комментарий опубликован в GitHub",
            warning: null,
            itemId,
            url: item.url,
          });
        }),
      comment_users: async ({ projectKey: key, itemId, query }) => {
        const { item } = await itemFor(key, itemId);
        if (!item.repository) return { users: [] };
        return {
          users: await commentServices.suggestCommentUsers(
            item.repository,
            query,
            await options(),
          ),
        };
      },
      comment_upload: async ({
        projectKey: key,
        itemId,
        name,
        contentType,
        base64,
      }) => {
        const { item } = await itemFor(key, itemId);
        if (!item.repository || item.kind === "DraftIssue")
          throw new Error(
            "Вложения доступны для задач и PR в репозитории GitHub.",
          );
        const opts = await options();
        const detail = await github.fetchItemDetail(item.contentId!, opts);
        if (!detail.viewerCanComment)
          throw new Error(
            "У текущего аккаунта нет доступа к комментированию этой задачи.",
          );
        if (base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(base64))
          throw new Error("Не удалось прочитать файл. Добавьте его повторно.");
        const bytes = Buffer.from(base64, "base64");
        if (bytes.toString("base64") !== base64)
          throw new Error("Не удалось прочитать файл. Добавьте его повторно.");
        if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024)
          throw new Error("Размер вложения должен быть от 1 байта до 5 МБ.");
        return commentServices.uploadCommentAttachment(
          item.repository,
          name,
          contentType,
          bytes,
          opts,
        );
      },
    });
    settings.onChange((next, previous) => {
      generation++;
      viewer = null;
      if (next.tokenFile !== previous.tokenFile)
        db.prepare("DELETE FROM projects_cache").run();
      bb.realtime.publish("workspace-changed", { configuration: true });
    });
    bb.cli.register({
      name: "github-projects",
      summary: "Read the GitHub Projects workspace",
      commands: [
        {
          name: "status",
          summary: "Connected projects and GitHub account",
          usage: "bb github-projects status [--json]",
        },
        {
          name: "list",
          summary: "Read configured projects and tasks",
          usage: "bb github-projects list [--json]",
        },
        {
          name: "refresh",
          summary: "Refresh configured projects",
          usage: "bb github-projects refresh [--json]",
        },
        {
          name: "projects",
          summary: "Discover projects for an owner",
          usage: "bb github-projects projects <owner> [--json]",
        },
      ],
      async run(argv) {
        const json = argv.includes("--json");
        const args = argv.filter((arg) => arg !== "--json");
        try {
          if (args[0] === "projects" && args[1]) {
            const ownerKind = await github.resolveOwnerKind(
              args[1],
              await options(),
            );
            const projects = await github.listProjects(
              ownerKind,
              args[1],
              await options(),
            );
            return {
              exitCode: 0,
              stdout: json
                ? JSON.stringify(projects)
                : projects
                    .map(
                      (project) =>
                        `${project.number}  ${project.title}  ${project.url}`,
                    )
                    .join("\n"),
            };
          }
          if (!args[0] || ["status", "list", "refresh"].includes(args[0])) {
            const state = await workspace(args[0] === "refresh");
            const value =
              args[0] === "status"
                ? {
                    viewerLogin: state.viewerLogin,
                    configured: state.configured,
                    projects: state.projects.map(
                      ({ key, problem, stale, fetchedAt }) => ({
                        key,
                        problem,
                        stale,
                        fetchedAt,
                      }),
                    ),
                    problem: state.problem,
                  }
                : state;
            const text = `GitHub: ${state.viewerLogin ?? "not connected"}\n${state.projects.map((project) => `${project.key}  ${project.board?.title ?? "unavailable"}  ${project.board?.items.length ?? 0} items${project.stale ? " (stale)" : ""}${project.problem ? ` — ${project.problem}` : ""}`).join("\n")}${state.problem ? `\n${state.problem}` : ""}`;
            return {
              exitCode:
                state.problem ||
                state.projects.some((project) => project.problem)
                  ? 1
                  : 0,
              stdout: json ? JSON.stringify(value) : text,
            };
          }
          return {
            exitCode: 1,
            stderr:
              "Usage: bb github-projects status|list|refresh|projects <owner> [--json]",
          };
        } catch (error) {
          return { exitCode: 1, stderr: message(error) };
        }
      },
    });
    bb.background.service("project-refresh", {
      async start(signal) {
        let last = Date.now();
        while (!signal.aborted) {
          try {
            await delay(60_000, undefined, { signal });
          } catch {
            return;
          }
          try {
            const cfg = await config();
            if (
              cfg.targets.length &&
              cfg.refreshMinutes > 0 &&
              Date.now() - last >= Math.max(1, cfg.refreshMinutes) * 60_000
            ) {
              last = Date.now();
              await workspace(true);
              bb.realtime.publish("workspace-changed", { refresh: true });
            }
          } catch (error) {
            bb.log.warn(`Refresh failed: ${message(error)}`);
          }
        }
      },
    });
    bb.onDispose(() => {
      controller.abort();
    });
  };
}
export default createPlugin();

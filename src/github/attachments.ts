import { extname } from "node:path";
import { z } from "zod";
import { graphql, runGh, type GhRunOptions } from "./cli.js";

/** Protocol follows cli/cli internal/attachments/client.go and userasset.go.
 * https://github.com/cli/cli/blob/trunk/internal/attachments/client.go
 * GitHub.com media uploads only; this is not a general-purpose file storage API.
 * Uploading creates an asset immediately, before the user posts a comment.
 * Never auto-retry: this endpoint has no documented asset deletion/idempotency API.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const contentTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};
export interface AttachmentOptions extends GhRunOptions {
  /** Dependency injection only; never send this through RPC. */
  fetch?: typeof fetch;
  getToken?: () => Promise<string>;
}
export interface UploadedAttachment {
  url: string;
  markdown: string;
  name: string;
}
export function validateAttachment(
  name: string,
  mimeType: string,
  bytes: Buffer,
): { name: string; contentType: string } {
  if (!name || name.length > 240 || /[/\\\x00-\x1f\x7f]/.test(name))
    throw new Error("Некорректное имя файла.");
  const contentType = contentTypes[extname(name).toLowerCase()];
  if (!contentType)
    throw new Error(
      "GitHub CLI поддерживает вложения PNG, JPEG, GIF, WebP, SVG, MP4, MOV и WebM. PDF и архивы не поддерживаются этим способом.",
    );
  if (
    mimeType &&
    mimeType !== "application/octet-stream" &&
    mimeType.toLowerCase() !== contentType
  )
    throw new Error("Тип файла не соответствует расширению.");
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length === 0 ||
    bytes.length > MAX_ATTACHMENT_BYTES
  )
    throw new Error("Выберите непустой файл размером не более 5 МиБ.");
  return { name, contentType };
}
/** Upload one media asset using the same credential selection as existing gh reads. */
export async function uploadCommentAttachment(
  repository: string,
  name: string,
  mimeType: string,
  bytes: Buffer,
  options: AttachmentOptions = {},
): Promise<UploadedAttachment> {
  if (process.env.GH_HOST && process.env.GH_HOST.toLowerCase() !== "github.com")
    throw new Error("Загрузка вложений поддерживается только для GitHub.com.");
  const file = validateAttachment(name, mimeType, bytes);
  const parts = repository.split("/");
  if (parts.length !== 2 || !parts.every((p) => /^[a-z\d._-]+$/i.test(p)))
    throw new Error("Укажите репозиторий в формате владелец/название.");
  const metadata = z
    .object({
      repository: z
        .object({
          databaseId: z.number().int().positive(),
          viewerPermission: z.string().nullable(),
          isArchived: z.boolean(),
          isDisabled: z.boolean(),
        })
        .nullable(),
    })
    .parse(
      await graphql(
        `
          query ($owner: String!, $name: String!) {
            repository(owner: $owner, name: $name) {
              databaseId
              viewerPermission
              isArchived
              isDisabled
            }
          }
        `,
        { owner: parts[0], name: parts[1] },
        options,
      ),
    );
  const repo = metadata.repository;
  if (!repo || repo.isArchived || repo.isDisabled)
    throw new Error("Репозиторий недоступен для загрузки файлов.");
  // Null is possible for installation credentials; the endpoint decides then.
  if (
    repo.viewerPermission &&
    !["WRITE", "MAINTAIN", "ADMIN"].includes(repo.viewerPermission)
  )
    throw new Error(
      "Для загрузки вложений нужен доступ на запись в репозиторий.",
    );
  const token = (
    await (options.getToken
      ? options.getToken()
      : runGh(["auth", "token", "--hostname", "github.com"], options))
  ).trim();
  if (!token || /\s/.test(token))
    throw new Error("Не удалось получить токен GitHub для загрузки.");
  const endpoint = new URL(
    "https://uploads.github.com/user-attachments/assets",
  );
  endpoint.searchParams.set("name", file.name);
  endpoint.searchParams.set("content_type", file.contentType);
  endpoint.searchParams.set("repository_id", String(repo.databaseId));
  const signal = options.signal
    ? AbortSignal.any([
        options.signal,
        AbortSignal.timeout(options.timeoutMs ?? 60_000),
      ])
    : AbortSignal.timeout(options.timeoutMs ?? 60_000);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/octet-stream",
        Accept: "application/vnd.github+json",
        "Content-Length": String(bytes.length),
      },
      body: new Uint8Array(bytes),
      signal,
    });
  } catch {
    throw new Error(
      "Не удалось завершить загрузку в GitHub. Не повторяйте её автоматически: файл мог быть принят сервером.",
    );
  }
  if (!response.ok) {
    if ([401, 403, 404].includes(response.status))
      throw new Error(
        "GitHub отклонил загрузку. Нужны права записи и поддерживаемый токен; проверьте разрешения и SSO.",
      );
    if (response.status === 429)
      throw new Error(
        "GitHub ограничил частоту загрузок. Подождите перед следующей попыткой.",
      );
    throw new Error(
      `GitHub отклонил загрузку файла (HTTP ${response.status}).`,
    );
  }
  let url: URL;
  try {
    const result = z
      .object({ url: z.string().url() })
      .parse(await response.json());
    url = new URL(result.url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      !url.pathname.startsWith("/user-attachments/assets/") ||
      url.username ||
      url.password ||
      url.port
    )
      throw new Error();
  } catch {
    throw new Error(
      "GitHub принял файл, но вернул некорректную ссылку. Не повторяйте загрузку автоматически.",
    );
  }
  const escapedName = file.name
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
  return {
    url: url.href,
    name: file.name,
    markdown: file.contentType.startsWith("video/")
      ? url.href
      : `![${escapedName}](${url.href})`,
  };
}

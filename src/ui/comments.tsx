import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Markdown, UrlLink, useRpc } from "@get-bb/plugin-sdk/app";
import type {
  rpcContract,
  ProjectItem,
  ItemDetail,
  MutationResult,
} from "../contracts";
import {
  MEDIA_ACCEPT,
  MEDIA_TYPES,
  mediaError,
  mentionAt,
  replaceRange,
  replyText,
} from "./comment-helpers";
type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type User = { login: string; name: string | null; avatarUrl: string | null };
type Attachment = {
  id: number;
  file: File;
  state: "uploading" | "failed" | "ready";
  error?: string;
  markdown?: string;
  url?: string;
};
export function TaskComments({
  rpc,
  projectKey,
  item,
  detail,
  loading,
  blocked,
  onLoadMore,
  onPosted,
  onPosting,
}: {
  rpc: Rpc;
  projectKey: string;
  item: ProjectItem;
  detail: ItemDetail | null;
  loading: boolean;
  blocked: boolean;
  onLoadMore: () => void;
  onPosted: (result: MutationResult) => Promise<void>;
  onPosting: (pending: boolean) => void;
}) {
  const [body, setBody] = useState(""),
    [preview, setPreview] = useState(false),
    [error, setError] = useState(""),
    [posting, setPosting] = useState(false),
    [files, setFiles] = useState<Attachment[]>([]),
    [reply, setReply] = useState<string | null>(null),
    [cursor, setCursor] = useState(0),
    [users, setUsers] = useState<User[]>([]),
    [choice, setChoice] = useState(0),
    [dismissed, setDismissed] = useState(false),
    [suggestionError, setSuggestionError] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null),
    picker = useRef<HTMLInputElement>(null),
    fileId = useRef(0),
    race = useRef(0),
    bodyRef = useRef(body),
    pendingRef = useRef(false),
    replyContext = useRef("");
  bodyRef.current = body;
  const uploading = files.some((f) => f.state === "uploading"),
    failed = files.some((f) => f.state === "failed"),
    canComment = item.kind !== "DraftIssue" && !!detail?.viewerCanComment;
  useEffect(() => {
    const pending = posting || uploading;
    pendingRef.current = pending;
    onPosting(pending);
  }, [posting, uploading, onPosting]);
  useEffect(
    () => () => {
      if (pendingRef.current) onPosting(false);
    },
    [onPosting],
  );
  const mention = !dismissed ? mentionAt(body, cursor) : null;
  useEffect(() => {
    const id = ++race.current;
    if (!mention) {
      setUsers([]);
      return;
    }
    const q = mention.query.toLowerCase();
    const local = [
      ...new Set([
        ...item.assignees.map((a) => a.login),
        ...(detail?.comments.flatMap((c) => (c.author ? [c.author] : [])) ||
          []),
      ]),
    ]
      .filter((login) => login.toLowerCase().startsWith(q))
      .map((login) => ({ login, name: null, avatarUrl: null }));
    setUsers(local.slice(0, 8));
    setChoice(0);
    setSuggestionError("");
    const timer = setTimeout(() => {
      rpc
        .call("comment_users", {
          projectKey,
          itemId: item.itemId,
          query: mention.query,
        })
        .then(
          (r) => {
            if (race.current !== id) return;
            setUsers(
              [
                ...new Map(
                  [...local, ...r.users].map((u) => [u.login.toLowerCase(), u]),
                ).values(),
              ].slice(0, 8),
            );
          },
          () => {
            if (race.current === id)
              setSuggestionError(
                "Поиск GitHub недоступен; показаны известные участники.",
              );
          },
        );
    }, 250);
    return () => {
      clearTimeout(timer);
      race.current++;
    };
  }, [
    mention?.query,
    mention?.start,
    projectKey,
    item.itemId,
    rpc,
    detail,
    item.assignees,
  ]);
  function insert(
    text: string,
    start = editor.current?.selectionStart ?? body.length,
    end = editor.current?.selectionEnd ?? start,
  ) {
    const next = replaceRange(bodyRef.current, start, end, text);
    setBody(next.body);
    bodyRef.current = next.body;
    setCursor(next.cursor);
    setPreview(false);
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }
  function format(before: string, after = "") {
    const start = editor.current?.selectionStart ?? body.length,
      end = editor.current?.selectionEnd ?? start;
    const text = bodyRef.current.slice(start, end) || "текст";
    insert(before + text + after, start, end);
  }
  function choose(user: User) {
    if (!mention) return;
    insert("@" + user.login + " ", mention.start, mention.end);
    setDismissed(true);
    setUsers([]);
  }
  function keys(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && users.length) {
      if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          setDismissed(true);
          setUsers([]);
        } else if (e.key === "ArrowDown")
          setChoice((choice + 1) % users.length);
        else if (e.key === "ArrowUp")
          setChoice((choice + users.length - 1) % users.length);
        else choose(users[choice] || users[0]);
      }
    } else if (mention && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
    }
  }
  async function upload(file: File, id: number) {
    setFiles((old) =>
      old.map((f) =>
        f.id === id ? { ...f, state: "uploading", error: undefined } : f,
      ),
    );
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error("Не удалось прочитать файл."));
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.readAsDataURL(file);
      });
      const ext = file.name.split(".").at(-1)?.toLowerCase() || "";
      const result = await rpc.call("comment_upload", {
        projectKey,
        itemId: item.itemId,
        name: file.name,
        contentType: MEDIA_TYPES[ext],
        base64,
      });
      setFiles((old) =>
        old.map((f) =>
          f.id === id
            ? {
                ...f,
                state: "ready",
                markdown: result.markdown,
                url: result.url,
              }
            : f,
        ),
      );
      setBody((old) => {
        const next =
          old +
          (old.endsWith("\n") || !old ? "" : "\n") +
          result.markdown +
          "\n";
        bodyRef.current = next;
        return next;
      });
    } catch (e) {
      setFiles((old) =>
        old.map((f) =>
          f.id === id
            ? {
                ...f,
                state: "failed",
                error: e instanceof Error ? e.message : String(e),
              }
            : f,
        ),
      );
    }
  }
  function addFiles(incoming: File[]) {
    if (!canComment || posting || blocked) return;
    for (const file of incoming) {
      const invalid = mediaError(file),
        id = ++fileId.current;
      setFiles((old) => [
        ...old,
        {
          id,
          file,
          state: invalid ? "failed" : "uploading",
          error: invalid || undefined,
        },
      ]);
      if (!invalid) void upload(file, id);
    }
  }
  function removeFile(file: Attachment) {
    if (file.state === "uploading") return;
    if (file.markdown)
      setBody((old) =>
        old.replace(file.markdown! + "\n", "").replace(file.markdown!, ""),
      );
    setFiles((old) => old.filter((f) => f.id !== file.id));
  }
  async function post(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || posting || uploading || failed || blocked) return;
    setPosting(true);
    onPosting(true);
    setError("");
    try {
      const result = await rpc.call("comment_add", {
        projectKey,
        itemId: item.itemId,
        body,
      });
      setBody("");
      bodyRef.current = "";
      setFiles([]);
      setReply(null);
      replyContext.current = "";
      await onPosted(result);
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : String(e)) +
          " Перед повторной публикацией проверьте обсуждение в GitHub: комментарий мог сохраниться.",
      );
    } finally {
      setPosting(false);
      onPosting(false);
    }
  }
  return (
    <section className="gp-comments-root gp-detail-section">
      <h3>Обсуждение</h3>
      {loading && !detail && <p role="status">Загрузка комментариев…</p>}
      {detail && !detail.comments.length && (
        <p className="gp-comments-help">
          Пока нет комментариев.{canComment ? " Начните обсуждение ниже." : ""}
        </p>
      )}
      {detail?.comments.map((c) => (
        <article className="gp-comments-item" key={c.id}>
          <header>
            <strong>{c.author || "GitHub"}</strong>
            <time dateTime={c.createdAt}>
              {new Date(c.createdAt).toLocaleString("ru-RU")}
            </time>
          </header>
          <Markdown content={c.body} className="gp-comments-markdown" />
          <footer>
            <UrlLink href={c.url}>Комментарий в GitHub</UrlLink>
            {canComment && (
              <button
                type="button"
                disabled={posting || blocked}
                onClick={() => {
                  const context = replyText(c);
                  if (replyContext.current) {
                    const next = bodyRef.current.replace(
                      replyContext.current,
                      "",
                    );
                    bodyRef.current = next;
                    setBody(next);
                  }
                  replyContext.current = context;
                  setReply(c.author || "GitHub");
                  insert(context, 0, 0);
                }}
              >
                Ответить
              </button>
            )}
          </footer>
        </article>
      ))}
      {detail?.commentsHasMore && (
        <button disabled={loading} onClick={onLoadMore}>
          {loading ? "Загрузка…" : "Загрузить ещё комментарии"}
        </button>
      )}
      {!detail && !loading && (
        <p className="gp-comments-help">
          Обсуждение не загружено. Нажмите «Перечитать задачу» выше, чтобы
          повторить запрос.
        </p>
      )}
      {item.kind === "DraftIssue" ? (
        <p className="gp-comments-help">
          Черновики Projects не поддерживают комментарии. Преобразуйте задачу в
          issue в GitHub.
        </p>
      ) : canComment ? (
        <form
          onSubmit={post}
          className="gp-comments-form"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            if (e.dataTransfer.files.length) {
              e.preventDefault();
              addFiles(Array.from(e.dataTransfer.files));
            }
          }}
        >
          {reply && (
            <div className="gp-comments-reply">
              Ответ @{reply} · комментарий будет опубликован в общем обсуждении{" "}
              <button
                type="button"
                onClick={() => {
                  const prefix = replyContext.current;
                  setBody((old) => old.replace(prefix, ""));
                  replyContext.current = "";
                  setReply(null);
                }}
              >
                Отменить ответ
              </button>
            </div>
          )}
          <div className="gp-comments-tabs">
            <button
              type="button"
              aria-pressed={!preview}
              onClick={() => setPreview(false)}
            >
              Редактор
            </button>
            <button
              type="button"
              aria-pressed={preview}
              onClick={() => setPreview(true)}
            >
              Предпросмотр
            </button>
          </div>
          {!preview && (
            <div className="gp-comments-toolbar" aria-label="Форматирование">
              {[
                ["Жирный", "**", "**"],
                ["Курсив", "_", "_"],
                ["Ссылка", "[", "](https://)"],
                ["Код", "`", "`"],
                ["Список", "\n- ", ""],
                ["Цитата", "\n> ", ""],
              ].map(([label, before, after]) => (
                <button
                  key={label}
                  type="button"
                  disabled={posting || blocked}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => format(before, after)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {preview ? (
            <div className="gp-comments-preview">
              <Markdown
                content={
                  body ||
                  "Предпросмотр пуст. Вернитесь в редактор и напишите комментарий."
                }
                className="gp-comments-markdown"
              />
            </div>
          ) : (
            <div className="gp-comments-editor">
              <label htmlFor={"gp-comment-" + item.itemId}>
                Новый комментарий
              </label>
              <textarea
                id={"gp-comment-" + item.itemId}
                ref={editor}
                value={body}
                disabled={posting || blocked}
                rows={5}
                placeholder="Markdown, @login, изображения и видео"
                onChange={(e) => {
                  setBody(e.target.value);
                  setCursor(e.target.selectionStart);
                  setDismissed(false);
                }}
                onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
                onKeyDown={keys}
                onPaste={(e) => {
                  const images = Array.from(e.clipboardData.items)
                    .filter(
                      (i) => i.kind === "file" && i.type.startsWith("image/"),
                    )
                    .flatMap((i) => {
                      const f = i.getAsFile();
                      return f ? [f] : [];
                    });
                  if (images.length) {
                    e.preventDefault();
                    addFiles(images);
                  }
                }}
                aria-autocomplete="list"
                aria-controls={
                  mention && users.length ? "gp-comment-users" : undefined
                }
                aria-expanded={!!mention && !!users.length}
                aria-activedescendant={
                  mention && users.length
                    ? "gp-comment-user-" + choice
                    : undefined
                }
              />
              {mention && users.length > 0 && (
                <div
                  id="gp-comment-users"
                  className="gp-comments-users"
                  role="listbox"
                  aria-label="Участники GitHub"
                >
                  {users.map((u, i) => (
                    <button
                      key={u.login}
                      id={"gp-comment-user-" + i}
                      role="option"
                      aria-selected={i === choice}
                      type="button"
                      className={i === choice ? "gp-comments-selected" : ""}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(u)}
                    >
                      <strong>{u.name || u.login}</strong>
                      <span>@{u.login}</span>
                    </button>
                  ))}
                </div>
              )}
              {suggestionError && mention && (
                <p className="gp-comments-help">{suggestionError}</p>
              )}
            </div>
          )}
          <input
            ref={picker}
            type="file"
            multiple
            accept={MEDIA_ACCEPT}
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={posting || blocked}
            onClick={() => picker.current?.click()}
          >
            Добавить изображения или видео
          </button>
          <p className="gp-comments-help">
            Файлы загружаются в GitHub при добавлении. PNG, JPG, JPEG, GIF,
            WEBP, SVG, MP4, MOV, WEBM · до 5 МиБ каждый. Можно перетащить файлы
            или вставить изображение из буфера.
          </p>
          {files.length > 0 && (
            <ul className="gp-comments-files">
              {files.map((f) => (
                <li key={f.id}>
                  <span>
                    <strong>{f.file.name}</strong> ·{" "}
                    {f.state === "uploading"
                      ? "Загрузка в GitHub…"
                      : f.state === "ready"
                        ? "Загружен в GitHub"
                        : f.error}
                  </span>
                  {f.state === "failed" && !mediaError(f.file) && (
                    <button
                      type="button"
                      disabled={posting}
                      onClick={() => void upload(f.file, f.id)}
                    >
                      Повторить загрузку
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={f.state === "uploading" || posting}
                    onClick={() => removeFile(f)}
                  >
                    Убрать из комментария
                  </button>
                </li>
              ))}
            </ul>
          )}
          {files.some((f) => f.state === "ready") && (
            <p className="gp-comments-help">
              «Убрать» удаляет вставку из текста. Уже загруженный файл остаётся
              в GitHub.
            </p>
          )}
          {error && (
            <p role="alert" className="gp-comments-error">
              {error}
            </p>
          )}
          <button
            className="gp-primary"
            type="submit"
            disabled={!body.trim() || posting || uploading || failed || blocked}
          >
            {posting
              ? "Публикация…"
              : uploading
                ? "Дождитесь загрузки файлов"
                : "Опубликовать комментарий"}
          </button>
        </form>
      ) : (
        !loading && (
          <p className="gp-comments-help">
            Текущий GitHub-аккаунт не может комментировать эту задачу.
          </p>
        )
      )}
    </section>
  );
}

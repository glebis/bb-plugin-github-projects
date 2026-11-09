import { customFields, fieldPreferencesKey, matchesFieldFilters, sanitizeFieldPreferences, unsetFieldFilter, visibleFields, type FieldPreferences } from "./src/ui/field-preferences";
import { ProjectFieldEditor } from "./src/ui/project-field-editor";
import { editableFields, fieldChanges, fieldDisplayValue } from "./src/ui/project-fields";
import { I18nProvider, useI18n } from "./src/ui/i18n";
import { TaskComments } from "./src/ui/comments";
import { IconButton } from "./src/ui/icon-button";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  definePluginApp,
  UrlLink,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk";
import type {
  rpcContract,
  Workspace,
  ProjectSnapshot,
  ProjectItem,
  ItemDetail,
  MutationResult,
  ProjectTarget,
} from "./src/contracts";
import "./app.css";
import { suggestedRepository } from "./src/model";
import { defaultColumnOrder, sanitizeLayouts, resolveColumnOrder, moveColumn, toggleCollapsed, type ColumnLayout } from "./src/ui/column-layout";
import {
  statusMove,
  withLocalStatus,
  type LocalStatus,
} from "./src/ui/board-drag";
import {
  blankRoute as blank,
  decodeViewRoute,
  initialViewRoute,
  stringMap,
  viewMap,
  visibility,
  viewKeys,
  scrollPosition,
  type ViewRoute as Route,
} from "./src/ui/view-state";
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const logins = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
const complete = (t: ProjectItem) =>
  t.state === "CLOSED" || t.state === "MERGED";
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    box.current
      ?.querySelector<HTMLElement>("button,input,select,textarea")
      ?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = Array.from(
          box.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
          ) || [],
        );
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="gp-veil"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        className="gp-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <IconButton onClick={onClose} label={t("Закрыть")} icon="X" />
        </header>
        {children}
      </div>
    </div>
  );
}
function Copy({ text }: { text: string }) {
  const { t } = useI18n();
  const [fallback, setFallback] = useState(false),
    [copied, setCopied] = useState(false);
  return (
    <span className="gp-copy">
      <code>{text}</code>
      <IconButton
        label={copied ? t("Идентификатор скопирован") : t("Копировать идентификатор")}
        icon={copied ? "Check" : "Copy"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setFallback(true);
          }
        }}
      />
      {fallback && (
        <input
          aria-label={t("Скопируйте идентификатор")}
          readOnly
          value={text}
          onFocus={(e) => e.target.select()}
        />
      )}
    </span>
  );
}
function WorkspacePage({ subPath }: PluginNavPanelProps) {
  const { t, localize, formatDate, number, plural, locale } = useI18n();
  const rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const [route, setRoute] = useState<Route>(() =>
    initialViewRoute(subPath, stored(viewKeys.route, null)),
  );
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [noticeUrl, setNoticeUrl] = useState<string | null>(null);
  const [dates, setDates] = useState<Record<string, string>>(() =>
    Object.keys(route.dateFields).length
      ? route.dateFields
      : stringMap(stored(viewKeys.dates, stored("gp-date-fields", {}))),
  );
  const [visible, setVisible] = useState(() =>
    visibility(stored(viewKeys.visible, stored("gp-visible", null))),
  );
  const [views, setViews] = useState<Record<string, "list" | "board">>(() =>
    viewMap(stored(viewKeys.views, stored("gp-views", {}))),
  );
  const [fieldPreferences, setFieldPreferences] = useState(() => sanitizeFieldPreferences(stored(fieldPreferencesKey, {})));
  useEffect(() => persist(fieldPreferencesKey, fieldPreferences), [fieldPreferences]);
  function changeFieldPreferences(projectKey: string, patch: Partial<FieldPreferences>) {
    setFieldPreferences(previous => ({ ...previous, [projectKey]: { ...previous[projectKey], ...patch, filters: patch.filters ?? previous[projectKey]?.filters ?? {} } }));
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const serial = useRef(0),
    initialized = useRef(false),
    routeRef = useRef(route),
    mutationRef = useRef(false);
  routeRef.current = route;
  const [mutationPending, setMutationPending] = useState(false);
  const [dragItem, setDragItem] = useState<{
    projectKey: string;
    itemId: string;
  } | null>(null);
  const [dragColumn, setDragColumn] = useState<string | null>(null);
  const [columnLayouts, setColumnLayouts] = useState(() => sanitizeLayouts(stored("bb-github-projects:columns-v1", {})));
  useEffect(() => persist("bb-github-projects:columns-v1", columnLayouts), [columnLayouts]);
  const [movingColumn, setMovingColumn] = useState<string | null>(null);
  const [columnDrop, setColumnDrop] = useState<{ name: string; placement: "before" | "after" } | null>(null);
  const [boardAnnouncement, setBoardAnnouncement] = useState("");
  const [savingItem, setSavingItem] = useState<string | null>(null);
  const lastDragEnd = useRef(0);
  const optimisticStatus = useRef<LocalStatus | null>(null);
  const onPending = useCallback((pending: boolean) => {
    mutationRef.current = pending;
    setMutationPending(pending);
  }, []);
  const load = useCallback(
    async (refresh = false) => {
      const request = ++serial.current;
      setBusy(true);
      try {
        const result = await rpc.call("workspace_get", { refresh });
        if (request === serial.current) {
          setWorkspace(
            optimisticStatus.current
              ? withLocalStatus(result, optimisticStatus.current)
              : result,
          );
          setError("");
        }
      } catch (e) {
        if (request === serial.current) setError(message(e));
      } finally {
        if (request === serial.current) setBusy(false);
      }
    },
    [rpc],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime("workspace-changed", () => void load());
  useEffect(() => {
    const next = decodeViewRoute(subPath);
    if (next) {
      routeRef.current = next;
      setRoute(next);
      persist(viewKeys.route, next);
      if (Object.keys(next.dateFields).length) setDates(next.dateFields);
    }
  }, [subPath]);
  const update = useCallback(
    (patch: Partial<Route>, replace = false) => {
      const current = routeRef.current;
      if (
        mutationRef.current &&
        ((patch.page !== undefined && patch.page !== current.page) ||
          (patch.task !== undefined && patch.task !== current.task) ||
          (patch.project !== undefined && patch.project !== current.project))
      ) {
        setNotice(
          "Запрос к GitHub ещё выполняется. Дождитесь результата перед переходом.",
        );
        return;
      }
      const next = { ...routeRef.current, ...patch };
      routeRef.current = next;
      setRoute(next);
      persist(viewKeys.route, next);
      navigate.toPluginPanel("workspace", {
        subPath: encodeURIComponent(JSON.stringify(next)),
        replace,
      });
    },
    [navigate],
  );
  useEffect(() => {
    if (!workspace || initialized.current) return;
    initialized.current = true;
    if (!decodeViewRoute(subPath)) {
      // Initial state already resolves saved navigation; publish it once to BB.
      update(routeRef.current, true);
    }
  }, [workspace, subPath, update]);
  // Wait for the loaded DOM, then restore each page/view independently. Scroll
  // listeners arm only after restoration so the initial zero cannot erase it.
  useEffect(() => {
    if (!workspace || !rootRef.current) return;
    const root = rootRef.current;
    const key = JSON.stringify([route.page, route.view]);
    const saved = stored<Record<string, unknown>>(viewKeys.scroll, {});
    const positions =
      saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    const wanted = scrollPosition(positions[key]);
    const main = root.querySelector<HTMLElement>(".gp-main");
    const board = () => root.querySelector<HTMLElement>(".gp-board");
    const nav = root.querySelector<HTMLElement>(".gp-sidebar nav");
    let armed = false;
    let position = wanted;
    const capture = () => {
      position = {
        main: main?.scrollTop ?? 0,
        board: board()?.scrollLeft ?? 0,
        outer: root.scrollTop,
        sidebar: nav?.scrollLeft ?? 0,
      };
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      if (!armed) return;
      const latest = stored<Record<string, unknown>>(viewKeys.scroll, {});
      const entries =
        latest && typeof latest === "object" && !Array.isArray(latest)
          ? latest
          : {};
      persist(viewKeys.scroll, { ...entries, [key]: position });
    };
    const onScroll = () => {
      if (!armed) return;
      capture();
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          save();
        }, 120);
    };
    const flush = () => {
      if (armed) capture();
      save();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const frame = requestAnimationFrame(() => {
      if (main) main.scrollTop = wanted.main;
      if (board()) board()!.scrollLeft = wanted.board;
      root.scrollTop = wanted.outer;
      if (nav) nav.scrollLeft = wanted.sidebar;
      armed = true;
      root.addEventListener("scroll", onScroll, true);
    });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      save();
      root.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [route.page, route.view, Boolean(workspace)]);
  const close = useCallback(() => {
    if (mutationRef.current) {
      setNotice(
        "Запрос к GitHub ещё выполняется. Дождитесь результата перед закрытием.",
      );
      return;
    }
    update({ task: "", project: "" }, true);
  }, [update]);
  useEffect(() => {
    if (
      workspace?.configured &&
      !["all", "mine", "settings"].includes(route.page) &&
      !workspace.projects.some((p) => p.key === route.page)
    ) {
      setNotice("Этот проект больше не подключён. Открыт обзор проектов.");
      update({ ...blank, page: "all" }, true);
    }
  }, [workspace, route.page, update]);
  const current = workspace?.projects.find((p) => p.key === route.page);
  const all = (workspace?.projects || []).flatMap((p) =>
    p.board ? p.board.items.map((item) => ({ item, p })) : [],
  );
  const me = workspace?.viewerLogin;
  const raw =
    route.page === "mine"
      ? all.filter(
          ({ item }) =>
            !!me &&
            item.assignees.some(
              (a) => a.login.toLowerCase() === me.toLowerCase(),
            ),
        )
      : all.filter(({ p }) => p.key === route.page);
  const filtered = raw.filter(
    ({ item, p }) =>
      (!route.q ||
        (
          item.title +
          " " +
          item.reference +
          " " +
          item.repository +
          " " +
          item.itemId
        )
          .toLowerCase()
          .includes(route.q.toLowerCase())) &&
      (!route.assignee ||
        item.assignees.some((a) => a.login === route.assignee)) &&
      (!route.status ||
        (item.singleSelect[p.board?.statusField?.name || ""] ||
          "Без статуса") === route.status) &&
      (!current?.board || matchesFieldFilters(current.board, item, fieldPreferences[current.key]?.filters ?? {})),
  );
  if (route.sort === "title")
    filtered.sort((a, b) => a.item.title.localeCompare(b.item.title, locale));
  if (route.sort === "date")
    filtered.sort((a, b) =>
      (a.item.text[dates[a.p.key]] || "9999").localeCompare(
        b.item.text[dates[b.p.key]] || "9999",
      ),
    );
  const people = [
    ...new Set(raw.flatMap(({ item }) => item.assignees.map((a) => a.login))),
  ].sort();
  const statuses = [
    ...new Set(
      raw.map(
        ({ item, p }) =>
          item.singleSelect[p.board?.statusField?.name || ""] || "Без статуса",
      ),
    ),
  ];
  const selected = all.find(
    ({ item, p }) => item.itemId === route.task && p.key === route.project,
  );
  const afterMutation = async (result: MutationResult) => {
    setNoticeUrl(result.url);
    setNotice(
      result.warning ? result.message + " " + result.warning : result.message,
    );
    await load(true);
  };
  function openPage(page: string) {
    update({ ...blank, page, view: views[page] || "list" });
  }
  function dropMove(column: string) {
    if (!dragItem || mutationRef.current) return null;
    const snapshot = workspace?.projects.find(
      (project) => project.key === dragItem.projectKey,
    );
    if (!snapshot) return null;
    try {
      return statusMove(snapshot, dragItem.itemId, column);
    } catch {
      return null;
    }
  }
  async function moveToColumn(column: string) {
    const move = dropMove(column);
    lastDragEnd.current = Date.now();
    setDragItem(null);
    setDragColumn(null);
    if (!move) return;
    const snapshot = workspace?.projects.find(
      (project) => project.key === move.projectKey,
    );
    const field = snapshot?.board?.statusField;
    const item = snapshot?.board?.items.find(
      (item) => item.itemId === move.itemId,
    );
    if (!field || !item) return;
    const previous: LocalStatus = {
      projectKey: move.projectKey,
      itemId: move.itemId,
      fieldName: field.name,
      value: item.singleSelect[field.name] ?? null,
    };
    const next: LocalStatus = {
      ...previous,
      value: move.fields[0].value === null ? null : column,
    };
    optimisticStatus.current = next;
    setWorkspace((current) =>
      current ? withLocalStatus(current, next) : current,
    );
    onPending(true);
    setSavingItem(move.projectKey + "/" + move.itemId);
    setError("");
    setNotice("Сохраняем статус в GitHub…");
    setNoticeUrl(null);
    try {
      const result = await rpc.call("item_update", move);
      await afterMutation(result);
    } catch (cause) {
      optimisticStatus.current = null;
      setWorkspace((current) =>
        current ? withLocalStatus(current, previous) : current,
      );
      setNotice("");
      setError(`Не удалось изменить статус: ${message(cause)}. Обновите проект перед повторной попыткой.`);
    } finally {
      optimisticStatus.current = null;
      setSavingItem(null);
      onPending(false);
    }
  }
  const statusDisplay = (name: string) => {
    const projects = current ? [current] : workspace?.projects ?? [];
    const isGithubOption = projects.some(p => p.board?.statusField?.options.some(option => option.name === name));
    return name === "Без статуса" && !isGithubOption ? t("Без статуса") : name;
  };
  const activeCustomFilters = !!current && Object.values(fieldPreferences[current.key]?.filters ?? {}).some(Boolean);
  function clearFilters() {
    if (current) changeFieldPreferences(current.key, { filters: {} });
    update({ q: "", assignee: "", status: "" }, true);
  }
  function groupRows() {
    const isBoard = route.view === "board";
    const groupNames = current?.board?.statusField
      ? ["Без статуса", ...current.board.statusField.options.map((o) => o.name)]
      : route.page === "mine"
        ? [
            "Без статуса",
            ...(workspace?.projects.flatMap(
              (project) =>
                project.board?.statusField?.options.map(
                  (option) => option.name,
                ) || [],
            ) || []),
          ]
        : statuses;
    const extra = filtered
      .map(
        ({ item, p }) =>
          item.singleSelect[p.board?.statusField?.name || ""] || "Без статуса",
      )
      .filter((n) => !groupNames.includes(n));
    const sourceNames = defaultColumnOrder([...groupNames, ...extra]);
    const layoutKey = JSON.stringify([route.page, current?.board?.statusField?.id || "all-statuses"]);
    const layout = columnLayouts[layoutKey] || { order: [], collapsed: [] };
    const names = isBoard ? resolveColumnOrder(sourceNames, layout) : sourceNames;
    function saveLayout(next: ColumnLayout) {
      setColumnLayouts((previous) => ({ ...previous, [layoutKey]: next }));
    }
    function reorderColumn(from: string, to: string, placement: "before" | "after") {
      saveLayout({ order: moveColumn(names, from, to, placement), collapsed: [...layout.collapsed] });
      setBoardAnnouncement(placement==="before"?t("Колонка «{name}» перемещена перед «{target}».",{name:statusDisplay(from),target:statusDisplay(to)}):t("Колонка «{name}» перемещена после «{target}».",{name:statusDisplay(from),target:statusDisplay(to)}));
    }
    if (!filtered.length)
      return (
        <div className="gp-empty">
          <h3>{t("Задач по этим условиям нет")}</h3>
          <p>{t("Сбросьте фильтры или создайте задачу. Остальные проекты доступны.")}</p>
          {(route.q || route.assignee || route.status || activeCustomFilters) && (
            <button
              onClick={clearFilters}
            >{t("Сбросить фильтры")}</button>
          )}{" "}
          <button
            disabled={mutationPending}
            onClick={() =>
              update({
                task: "new",
                project:
                  current?.key ||
                  workspace?.projects.find((p) => p.board)?.key ||
                  "",
              })
            }
          >{t("Создать задачу")}</button>
        </div>
      );
    return (
      <div className={isBoard ? "gp-board" : ""} style={isBoard ? { gridTemplateColumns: names.map((name) => layout.collapsed.includes(name) ? "44px" : "min(300px, 100%)").join(" ") } : undefined}>
        {names.map((name) => {
          const items = filtered.filter(
            ({ item, p }) =>
              (item.singleSelect[p.board?.statusField?.name || ""] ||
                "Без статуса") === name,
          );
          if (!items.length && route.view !== "board") return null;
          const collapsed = isBoard && layout.collapsed.includes(name);
          return (
            <section
              className={
                "gp-group" + (dragColumn === name ? " gp-drop-target" : "") +
                (collapsed ? " gp-column-collapsed" : "") +
                (movingColumn === name ? " gp-column-dragging" : "") +
                (columnDrop?.name === name ? ` gp-column-drop-${columnDrop.placement}` : "")
              }
              key={name}
              data-status-column={name}
              data-column-collapsed={collapsed || undefined}
              aria-label={t("{value0}, задач: {value1}", {value0: statusDisplay(name), value1: number(items.length)})}
              onDragOver={(event) => {
                if (isBoard && movingColumn) {
                  if (movingColumn === name) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const rect = event.currentTarget.getBoundingClientRect();
                  const placement = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
                  setColumnDrop((previous) => previous?.name === name && previous.placement === placement ? previous : { name, placement });
                  return;
                }
                if (route.view !== "board" || !dropMove(name)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragColumn(name);
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                ) {
                  setDragColumn((column) => (column === name ? null : column));
                  setColumnDrop((target) => target?.name === name ? null : target);
                }
              }}
              onDrop={(event) => {
                if (route.view !== "board") return;
                event.preventDefault();
                if (movingColumn) {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const placement = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
                  if (movingColumn !== name) reorderColumn(movingColumn, name, placement);
                  setMovingColumn(null);
                  setColumnDrop(null);
                  return;
                }
                void moveToColumn(name);
              }}
            >
              {isBoard ? <div className="gp-column-header">
                <h3><button type="button" className="gp-column-handle" draggable
                  aria-label={t("Переместить колонку {value0}", {value0: statusDisplay(name)})}
                  aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                  title={t("Перетащите колонку или используйте Alt + стрелки влево/вправо")}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", name);
                    setDragItem(null);
                    setDragColumn(null);
                    setMovingColumn(name);
                    setColumnDrop(null);
                  }}
                  onDragEnd={() => { setMovingColumn(null); setColumnDrop(null); }}
                  onKeyDown={(event) => {
                    if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                    event.preventDefault();
                    const direction = event.key === "ArrowLeft" ? -1 : 1;
                    const neighbor = names[names.indexOf(name) + direction];
                    if (!neighbor) return;
                    reorderColumn(name, neighbor, direction < 0 ? "before" : "after");
                    requestAnimationFrame(() => {
                      const column = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-status-column]") || []).find((element) => element.dataset.statusColumn === name);
                      column?.querySelector<HTMLButtonElement>(".gp-column-handle")?.focus();
                    });
                  }}>
                  <svg className="gp-column-grip" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="3" r="1"/><circle cx="11" cy="3" r="1"/><circle cx="5" cy="8" r="1"/><circle cx="11" cy="8" r="1"/><circle cx="5" cy="13" r="1"/><circle cx="11" cy="13" r="1"/></svg>
                  <span className="gp-column-name">{statusDisplay(name)}</span><span className="gp-count">{number(items.length)}</span>
                </button></h3>
                <button type="button" className="gp-icon-button gp-column-toggle"
                  aria-label={collapsed?t("Развернуть колонку {name}",{name:statusDisplay(name)}):t("Свернуть колонку {name}",{name:statusDisplay(name)})}
                  aria-expanded={!collapsed}
                  data-tooltip={collapsed ? t("Развернуть колонку") : t("Свернуть колонку")}
                  onClick={() => {
                    saveLayout(toggleCollapsed({ order: names, collapsed: layout.collapsed }, name));
                    setBoardAnnouncement(collapsed?t("Колонка «{name}» развёрнута.",{name:statusDisplay(name)}):t("Колонка «{name}» свёрнута.",{name:statusDisplay(name)}));
                  }}><svg className="gp-icon-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={collapsed ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"}/></svg></button>
              </div> : <h3>
                {statusDisplay(name)} <span className="gp-count">{number(items.length)}</span>
              </h3>}
              {!collapsed && <div className="gp-rows">
                {items.map(({ item, p }) => {
                  const due = item.text[dates[p.key]];
                  return (
                    <button
                      className={
                        "gp-task" +
                        (dragItem?.itemId === item.itemId &&
                        dragItem.projectKey === p.key
                          ? " gp-dragging"
                          : "")
                      }
                      key={p.key + item.itemId}
                      draggable={
                        route.view === "board" &&
                        !!p.board?.statusField &&
                        !!p.board.viewerCanUpdate &&
                        !p.stale &&
                        !p.problem &&
                        !mutationPending
                      }
                      aria-busy={savingItem === p.key + "/" + item.itemId}
                      disabled={savingItem === p.key + "/" + item.itemId}
                      onDragStart={(event) => {
                        if (mutationRef.current) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData(
                          "text/plain",
                          item.reference || item.itemId,
                        );
                        setDragItem({ projectKey: p.key, itemId: item.itemId });
                        setMovingColumn(null);
                        setColumnDrop(null);
                      }}
                      onDragEnd={() => {
                        lastDragEnd.current = Date.now();
                        setDragItem(null);
                        setDragColumn(null);
                      }}
                      onClick={() => {
                        if (
                          Date.now() - lastDragEnd.current < 250 ||
                          mutationRef.current
                        )
                          return;
                        update({ task: item.itemId, project: p.key });
                      }}
                    >
                      <span className="gp-id">
                        {item.number ? "#" + item.number : t("Черновик")}
                      </span>
                      <span className="gp-task-title">
                        <strong>{item.title}</strong>
                        <small>
                          {item.repository || p.board?.title} ·{" "}
                          {item.reference || item.itemId}
                          {item.commentCount != null &&
                            item.commentCount > 0 &&
                            t(" · Комментарии: {value0}", {value0: number(item.commentCount)})}
                        </small>
                        {p.board && <span className="gp-task-fields">
                          {visibleFields(p.board, fieldPreferences[p.key]).map(field => {
                            const value = fieldDisplayValue(field, item);
                            if (!value) return null;
                            const formatted = field.dataType === "DATE" ? formatDate(value, { day: "numeric", month: "short" })
                              : field.dataType === "NUMBER" ? number(Number(value)) : value;
                            return <span key={field.id} className="gp-task-field"><span>{field.name}:</span> {formatted}</span>;
                          })}
                        </span>}
                      </span>
                      {visible.date &&
                        due &&
                        /^\d{4}-\d{2}-\d{2}$/.test(due) && (
                          <span className="gp-date">
                            {formatDate(new Date(due+"T12:00:00"), {day:"numeric",month:"short"})}
                            {complete(item) ? t(" · закрыто") : ""}
                          </span>
                        )}
                      {visible.assignee && (
                        <span className="gp-assignees">
                          {item.assignees.map((a) => a.login).join(", ") ||
                            t("Не назначен")}
                        </span>
                      )}
                    </button>
                  );
                })}
                {!items.length && (
                  <p className="gp-muted">{t("Нет задач в этой группе")}</p>
                )}
              </div>}
            </section>
          );
        })}
      </div>
    );
  }
  return (
    <div className="gp-app" ref={rootRef} lang={locale}>
      <div className="gp-sr-only" role="status" aria-live="polite">{localize(boardAnnouncement)}</div>
      <aside className="gp-sidebar">
        <div className="gp-brand">{t("Проекты")}</div>
        <label className="gp-mobile-nav">{t("Раздел")}<select
            aria-label={t("Раздел рабочего пространства")}
            value={route.page}
            onChange={(e) => openPage(e.target.value)}
          >
            <option value="all">{t("Все проекты")}</option>
            <option value="mine">{t("Мои задачи")}</option>
            {workspace?.projects.map((p) => (
              <option key={p.key} value={p.key}>
                {p.board?.title || p.target.owner + " #" + p.target.number}
              </option>
            ))}
            <option value="settings">{t("Настройки")}</option>
          </select>
        </label>
        <nav aria-label={t("Разделы")}>
          <button
            className={route.page === "all" ? "gp-active" : ""}
            onClick={() => openPage("all")}
          >{t("Все проекты")}</button>
          <button
            className={route.page === "mine" ? "gp-active" : ""}
            onClick={() => openPage("mine")}
          >{t("Мои задачи")}</button>
          <hr />
          {workspace?.projects.map((p) => (
            <button
              key={p.key}
              className={route.page === p.key ? "gp-active" : ""}
              onClick={() => openPage(p.key)}
            >
              {p.board?.title || p.target.owner + " #" + p.target.number}
            </button>
          ))}
          <hr />
          <button
            className={route.page === "settings" ? "gp-active" : ""}
            onClick={() => openPage("settings")}
          >{t("Настройки")}</button>
        </nav>
        <p className="gp-muted gp-identity">
          GitHub: {me || t("аккаунт не определён")}
        </p>
      </aside>
      <main className="gp-main">{!workspace&&<LanguagePicker/>}
        {mutationPending && (
          <p className="gp-notice" role="status">{t("Запрос к GitHub выполняется. Не закрывайте задачу; повторная отправка не выполняется автоматически.")}</p>
        )}
        <header className="gp-top">
          <div>
            <h1>
              {route.page === "all"
                ? t("Все проекты")
                : route.page === "mine"
                  ? t("Мои задачи")
                  : route.page === "settings"
                    ? t("Настройки")
                    : current?.board?.title || t("Проект")}
            </h1>
            <p className="gp-muted">
              {route.page === "mine"
                ? t("Задачи аккаунта {login} во всех подключённых проектах",{login:me||"GitHub"})
                : current?.board?.description ||
                  t("GitHub Projects · рабочее пространство")}
            </p>
          </div>
          <div className="gp-actions">
            <IconButton
              icon="RefreshCw"
              label={t("Обновить проекты")}
              busyLabel={t("Обновление проектов")}
              busy={busy}
              onClick={() => void load(true)}
            />
            {!!workspace?.projects.some((p) => p.board) && (
              <button
                className="gp-primary"
                onClick={() =>
                  update({
                    task: "new",
                    project:
                      current?.key ||
                      workspace.projects.find((p) => p.board)?.key ||
                      "",
                  })
                }
              >{t("Новая задача")}</button>
            )}
          </div>
        </header>
        {error && (
          <div role="alert" className="gp-warning">
            {localize(error)}{" "}
            <IconButton
              icon="RefreshCw"
              label={t("Повторить загрузку проектов")}
              busy={busy}
              onClick={() => void load()}
            />
          </div>
        )}
        {notice && (
          <div className="gp-notice" role="status">
            {localize(notice)}{" "}
            {noticeUrl && (
              <UrlLink href={noticeUrl}>{t("Открыть результат в GitHub")}</UrlLink>
            )}{" "}
            <IconButton
              onClick={() => setNotice("")}
              label={t("Закрыть уведомление")}
              icon="X"
            />
          </div>
        )}
        {workspace?.problem && (
          <div className="gp-warning">{localize(workspace.problem)}</div>
        )}
        {workspace?.projects
          .filter((p) => p.stale || p.problem || p.board?.warnings.length)
          .map((p) => (
            <div className="gp-warning" role="status" key={p.key}>
              <strong>
                {p.board?.title || p.target.owner + " #" + p.target.number}:
              </strong>{" "}
              {p.problem?localize(p.problem):p.board?.warnings.length?p.board.warnings.map(localize).join(" "):t("Показана сохранённая версия.")}{" "}
              {p.stale && t("Данные могут быть устаревшими.")}
              {p.fetchedAt && (
                <small>
                  {" "}{t("Прочитано:")}{" "}{formatDate(p.fetchedAt, {dateStyle:"short",timeStyle:"short"})}
                </small>
              )}
            </div>
          ))}
        {!workspace ? (
          <div className="gp-empty">
            {busy
              ? t("Загрузка проектов…")
              : t("Не удалось загрузить рабочее пространство.")}
          </div>
        ) : !workspace.configured || route.page === "settings" ? (
          <>
            <Settings
              workspace={workspace}
              rpc={rpc}
              onConfigured={(w) => {
                setWorkspace(w);
                setNotice("Настройки сохранены.");
                if (route.page !== "settings")
                  openPage(w.projects[0]?.key || "all");
              }}
            />
            <section className="gp-settings">
              <h2>{t("Представление")}</h2>
              <label>
                <input
                  type="checkbox"
                  checked={visible.assignee}
                  onChange={(e) => {
                    const v = { ...visible, assignee: e.target.checked };
                    setVisible(v);
                    persist(viewKeys.visible, v);
                  }}
                />{" "}{t("Показывать исполнителей")}</label>
              <label>
                <input
                  type="checkbox"
                  checked={visible.date}
                  onChange={(e) => {
                    const v = { ...visible, date: e.target.checked };
                    setVisible(v);
                    persist(viewKeys.visible, v);
                  }}
                />{" "}{t("Показывать даты")}</label>
              <p className="gp-muted">{t("Внешний вид следует теме bb. Локальные правила обязательных полей и проверки пока не применяются.")}</p>
            </section>
          </>
        ) : route.page === "all" ? (
          <div className="gp-projects">
            {workspace.projects.map((p) => (
              <article className="gp-project-card" key={p.key}>
                <h2>
                  <button onClick={() => openPage(p.key)}>
                    {p.board?.title || p.target.owner + " #" + p.target.number}
                  </button>
                </h2>
                <p className="gp-muted">
                  {p.board?.description || p.target.owner}
                </p>
                {p.board ? (
                  <>
                    <p>{number(p.board.items.length)} {plural(p.board.items.length,{one:"задача",few:"задачи",many:"задач",other:"задач"})}</p>
                    {p.board.statusField?.options.map((o) => (
                      <button
                        className="gp-project-stat"
                        key={o.id}
                        onClick={() =>
                          update({
                            ...blank,
                            page: p.key,
                            status: o.name,
                            view: views[p.key] || "list",
                          })
                        }
                      >
                        <span>{o.name}</span>
                        <strong>
                          {
                            p.board!.items.filter(
                              (i) =>
                                i.singleSelect[p.board!.statusField!.name] ===
                                o.name,
                            ).length
                          }
                        </strong>
                      </button>
                    ))}
                    <button
                      className="gp-project-stat"
                      onClick={() =>
                        update({
                          ...blank,
                          page: p.key,
                          status: "Без статуса",
                          view: views[p.key] || "list",
                        })
                      }
                    >
                      <span>{t("Без статуса")}</span>
                      <strong>
                        {
                          p.board.items.filter(
                            (i) =>
                              !i.singleSelect[p.board!.statusField?.name || ""],
                          ).length
                        }
                      </strong>
                    </button>
                  </>
                ) : (
                  <p>{t("Данные недоступны")}</p>
                )}
                <button onClick={() => openPage(p.key)}>{t("Открыть проект →")}</button>
              </article>
            ))}
          </div>
        ) : (
          <>
            <div className="gp-toolbar">
              <input
                aria-label={t("Поиск задач")}
                placeholder={t("Поиск по названию или номеру")}
                value={route.q}
                onChange={(e) => update({ q: e.target.value }, true)}
              />
              <select
                aria-label={t("Исполнитель")}
                value={route.assignee}
                onChange={(e) => update({ assignee: e.target.value }, true)}
              >
                <option value="">{t("Все исполнители")}</option>
                {people.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <select
                aria-label={t("Статус")}
                value={route.status}
                onChange={(e) => update({ status: e.target.value }, true)}
              >
                <option value="">{t("Все статусы")}</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>{statusDisplay(s)}</option>
                ))}
              </select>
              <select
                aria-label={t("Сортировка")}
                value={route.sort}
                onChange={(e) => update({ sort: e.target.value }, true)}
              >
                <option value="project">{t("Порядок проекта")}</option>
                <option value="title">{t("По названию")}</option>
                <option value="date">{t("По выбранной дате")}</option>
              </select>
              <div className="gp-segment">
                {(["list", "board"] as const).map((v) => (
                  <button
                    key={v}
                    aria-pressed={route.view === v}
                    className={route.view === v ? "gp-active" : ""}
                    onClick={() => {
                      const next = { ...views, [route.page]: v };
                      setViews(next);
                      persist(viewKeys.views, next);
                      update({ view: v });
                    }}
                  >
                    {v === "list" ? t("Список") : t("Доска")}
                  </button>
                ))}
              </div>
            </div>
            {current?.board && customFields(current.board).length > 0 && (
              <div className="gp-custom-controls" aria-label={t("Настройки полей проекта")}>
                {customFields(current.board).map(field => (
                  <label className="gp-field-filter" key={field.id}>
                    {field.name}
                    {field.dataType === "SINGLE_SELECT" ? <select
                      value={fieldPreferences[current.key]?.filters[field.id] ?? ""}
                      onChange={event => changeFieldPreferences(current.key, { filters: { ...fieldPreferences[current.key]?.filters, [field.id]: event.target.value } })}>
                      <option value="">{t("Все значения")}</option>
                      <option value={unsetFieldFilter}>{t("Не задано")}</option>
                      {field.options?.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select> : <input
                      type={field.dataType === "DATE" ? "date" : "text"}
                      inputMode={field.dataType === "NUMBER" ? "decimal" : undefined}
                      placeholder={t("Фильтр по полю")}
                      value={fieldPreferences[current.key]?.filters[field.id] ?? ""}
                      onChange={event => changeFieldPreferences(current.key, { filters: { ...fieldPreferences[current.key]?.filters, [field.id]: event.target.value } })}/>}
                  </label>
                ))}
                {activeCustomFilters && <button onClick={clearFilters}>{t("Сбросить фильтры")}</button>}
                <details className="gp-field-visibility">
                  <summary>{t("Поля на карточках")}</summary>
                  <div>{customFields(current.board).map(field => <label key={field.id}>
                    <input type="checkbox" checked={visibleFields(current.board!, fieldPreferences[current.key]).some(visible => visible.id === field.id)}
                      onChange={event => {
                        const ids = visibleFields(current.board!, fieldPreferences[current.key]).map(visible => visible.id);
                        changeFieldPreferences(current.key, { visible: event.target.checked ? [...ids, field.id] : ids.filter(id => id !== field.id) });
                      }}/>{field.name}
                  </label>)}</div>
                </details>
              </div>
            )}
            {current?.board && (
              <div className="gp-meta">
                <span>
                  {t("{shown} из {total} {tasks}", { shown: number(filtered.length), total: number(raw.length), tasks: plural(raw.length, { one: "задача", few: "задачи", many: "задач", other: "задач" }) })} ·{" "}
                  <UrlLink href={current.board.url}>{t("Открыть проект в GitHub")}</UrlLink>
                </span>
                {current.board.dateFields.length > 0 && (
                  <label>{t("Дата в списке")}{" "}
                    <select
                      value={dates[current.key] || ""}
                      onChange={(e) => {
                        const next = {
                          ...dates,
                          [current.key]: e.target.value,
                        };
                        setDates(next);
                        persist(viewKeys.dates, next);
                        update({ dateFields: next }, true);
                      }}
                    >
                      <option value="">{t("Не показывать")}</option>
                      {current.board.dateFields.map((f) => (
                        <option key={f.id} value={f.name}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
            {groupRows()}
          </>
        )}
        {route.task === "new" && workspace && (
          <Modal title={t("Новая задача")} onClose={close}>
            <CreateTask
              workspace={workspace}
              projectKey={route.project}
              rpc={rpc}
              onPending={onPending}
              onDone={async (r) => {
                close();
                await afterMutation(r);
              }}
            />
          </Modal>
        )}
        {selected && (
          <Modal
            title={
              selected.item.number
                ? t("Задача #{number}",{number:selected.item.number})
                : t("Черновик задачи")
            }
            onClose={close}
          >
            <TaskDetail
              key={selected.p.key + selected.item.itemId}
              snapshot={selected.p}
              item={selected.item}
              rpc={rpc}
              onPending={onPending}
              onDone={afterMutation}
            />
          </Modal>
        )}
      </main>
    </div>
  );
}
type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
function LanguagePicker() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="gp-language">
      {t("Язык")}
      <select aria-label={t("Язык интерфейса")} value={locale}
        onChange={event => setLocale(event.target.value === "ru" ? "ru" : "en")}>
        <option value="en">English</option>
        <option value="ru">Русский</option>
      </select>
    </label>
  );
}
function Settings({
  workspace,
  rpc,
  onConfigured,
}: {
  workspace: Workspace;
  rpc: Rpc;
  onConfigured: (w: Workspace) => void;
}) {
  const { t, localize } = useI18n();
  const [owner, setOwner] = useState(
      workspace.viewerLogin || workspace.projects[0]?.target.owner || "",
    ),
    [repository, setRepository] = useState(workspace.defaultRepository),
    [selected, setSelected] = useState<ProjectTarget[]>(
      workspace.projects.map((p) => p.target),
    );
  const [found, setFound] = useState<{
      owner: string;
      kind: ProjectTarget["ownerKind"];
      projects: { number: number; title: string; closed: boolean }[];
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [removedName, setRemovedName] = useState("");
  const targetKey = (t: Pick<ProjectTarget, "owner" | "number">) =>
    t.owner.toLowerCase() + ":" + t.number;
  const savedTarget = (t: ProjectTarget) =>
    workspace.projects.some((p) => targetKey(p.target) === targetKey(t));
  const friendlyName = (target: ProjectTarget) =>
    workspace.projects.find((p) => targetKey(p.target) === targetKey(target))?.board
      ?.title ||
    projectNames[targetKey(target)] ||
    (found?.owner.toLowerCase() === target.owner.toLowerCase()
      ? found.projects.find((p) => p.number === target.number)?.title
      : undefined) ||
    t("Проект GitHub #{number}", { number: target.number });
  useEffect(() => {
    if (!owner && workspace.viewerLogin) setOwner(workspace.viewerLogin);
  }, [workspace.viewerLogin, owner]);
  async function discover(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await rpc.call("projects_discover", { owner: owner.trim() });
      setProjectNames((previous) => ({
        ...previous,
        ...Object.fromEntries(
          r.projects.map((p) => [
            owner.trim().toLowerCase() + ":" + p.number,
            p.title,
          ]),
        ),
      }));
      setFound({
        owner: owner.trim(),
        kind: r.ownerKind,
        projects: r.projects,
      });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function configure() {
    setBusy(true);
    setError("");
    try {
      onConfigured(
        await rpc.call("configure", {
          projects: selected,
          defaultRepository: repository,
        }),
      );
      setRemovedName("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="gp-settings"><LanguagePicker/>
      <h2>
        {workspace.configured
          ? t("Подключённые проекты")
          : t("Подключите GitHub Projects")}
      </h2>
      <p className="gp-muted">{t("Используется общий GitHub-аккаунт сервера:")}{" "}
        <strong>{workspace.viewerLogin || t("не определён")}</strong>{t(". Доступ и авторство изменений соответствуют этому аккаунту.")}</p>
      <form className="gp-discover" onSubmit={discover}>
        <label>{t("Пользователь или организация")}<input
            required
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="GitHub login"
          />
        </label>
        <button disabled={busy}>{busy ? t("Загрузка…") : t("Найти проекты")}</button>
      </form>
      {selected.length > 0 && (
        <section
          className="gp-connected-projects"
          aria-label={t("Выбранные проекты")}
        >
          <h3>{t("Проекты для подключения к bb")}</h3>
          {selected.map((target) => {
            const name = friendlyName(target),
              saved = savedTarget(target);
            return (
              <div className="gp-connected-row" key={targetKey(target)}>
                <div className="gp-connected-name">
                  <strong>{name}</strong>
                  <small>
                    {target.owner} / #{target.number} ·{" "}
                    {saved ? t("Подключён") : t("Выбран, ещё не сохранён")}
                  </small>
                </div>
                <button
                  type="button"
                  aria-label={
                    saved?t("Отключить {name} от bb",{name}):t("Не подключать {name}",{name})
                  }
                  onClick={() => {
                    setSelected(
                      selected.filter((s) => targetKey(s) !== targetKey(target)),
                    );
                    setRemovedName(name);
                  }}
                  disabled={busy}
                >
                  {saved ? t("Отключить от bb") : t("Не подключать")}
                </button>
              </div>
            );
          })}
        </section>
      )}
      <p className="gp-connected-help">{t("Изменения вступят в силу после «Сохранить подключение». Проекты и задачи в GitHub сохранятся.")}</p>
      {removedName && (
        <p className="gp-connected-pending" role="status">
          {t("«{name}» исключён из выбора. Сохраните подключение, чтобы применить изменение.",{name:removedName})}</p>
      )}
      {found && (
        <fieldset disabled={busy}>
          <legend>{t("Проекты {owner}",{owner:found.owner})}</legend>
          {found.projects.length ? (
            found.projects.map((p) => {
              const checked = selected.some(
                (t) =>
                  t.owner.toLowerCase() === found.owner.toLowerCase() &&
                  t.number === p.number,
              );
              return (
                <label key={p.number}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && selected.length >= 25}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [
                              ...selected,
                              {
                                owner: found.owner,
                                ownerKind: found.kind,
                                number: p.number,
                              },
                            ]
                          : selected.filter(
                              (t) =>
                                t.owner.toLowerCase() !==
                                  found.owner.toLowerCase() ||
                                t.number !== p.number,
                            ),
                      )
                    }
                  />{" "}
                  {p.title}{" "}
                  <small>
                    #{p.number}
                    {p.closed ? t(" · закрыт") : ""}
                  </small>
                </label>
              );
            })
          ) : (
            <p>{t("Проектов не найдено. Проверьте владельца и доступ аккаунта.")}</p>
          )}
        </fieldset>
      )}
      <label>{t("Репозиторий по умолчанию")}<input
          value={repository}
          onChange={(e) => setRepository(e.target.value)}
          placeholder="owner/repository"
        />
      </label>
      <p className="gp-muted">{t("Необязателен: без репозитория создаётся черновик в проекте. Можно подключить до 25 проектов.")}</p>
      {error && (
        <p role="alert" className="gp-warning">
          {localize(error)}
        </p>
      )}
      <button
        className="gp-primary"
        disabled={busy}
        onClick={() => void configure()}
      >
        {busy ? t("Сохранение…") : t("Сохранить подключение")}
      </button>
    </section>
  );
}
function TaskDetail({
  snapshot,
  item,
  rpc,
  onDone,
  onPending,
}: {
  snapshot: ProjectSnapshot;
  item: ProjectItem;
  rpc: Rpc;
  onDone: (r: MutationResult) => Promise<void>;
  onPending: (pending: boolean) => void;
}) {
  const { t, localize } = useI18n();
  const [detail, setDetail] = useState<ItemDetail | null>(null),
    [title, setTitle] = useState(item.title),
    [body, setBody] = useState(item.body),
    [assignees, setAssignees] = useState(
      item.assignees.map((a) => a.login).join(", "),
    ),
    [values, setValues] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [loading, setLoading] = useState(true),
    [saved, setSaved] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const commentPending = useCallback(
    (value: boolean) => {
      setCommentBusy(value);
      onPending(value);
    },
    [onPending],
  );
  const board = snapshot.board!;
  const baseline = useRef({
    title: item.title,
    body: item.body,
    assignees: item.assignees.map((a) => a.login).join(", "),
  });
  const assignmentIncomplete = item.warnings.some((w) => /assignees/i.test(w));
  const ref = { projectKey: snapshot.key, itemId: item.itemId };
  const load = useCallback(
    async (after?: string) => {
      setLoading(true);
      try {
        const d = await rpc.call("item_detail", {
          projectKey: snapshot.key,
          itemId: item.itemId,
          ...(after ? { after } : {}),
        });
        setDetail((old) =>
          after && old
            ? { ...d, comments: [...old.comments, ...d.comments] }
            : d,
        );
        if (!after) {
          const previousBody = baseline.current.body;
          setBody((current) => (current === previousBody ? d.body : current));
          baseline.current.body = d.body;
        }
        setError("");
      } catch (e) {
        setError(message(e));
      } finally {
        setLoading(false);
      }
    },
    [rpc, snapshot.key, item.itemId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (pending || commentBusy || (!dirtyContent && !dirtyFields)) return;
    setPending(true);
    onPending(true);
    setError("");
    setSaved("");
    try {
      const fields = fieldChanges(board,item,values);
      const r = await rpc.call("item_update", {
        ...ref,
        ...(canEdit && detail
          ? {
              ...(title !== baseline.current.title ? { title } : {}),
              ...(body !== baseline.current.body ? { body } : {}),
              ...(!assignmentIncomplete &&
              assignees !== baseline.current.assignees
                ? { assignees: logins(assignees) }
                : {}),
            }
          : {}),
        ...(board.viewerCanUpdate ? { fields } : {}),
      });
      setSaved(r.warning
        ? r.message + " " + r.warning + " GitHub вернул предупреждение. Введённые значения полей сохранены в форме. Проверьте задачу и оставшиеся изменения перед повторным сохранением."
        : r.message);
      if (!r.warning) {
        baseline.current = { title, body, assignees };
        setValues({});
      }
      await onDone(r);
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
      onPending(false);
    }
  }
  const canEdit = detail?.viewerCanUpdate ?? item.viewerCanUpdate;
  const dirtyContent =
    !!detail &&
    canEdit &&
    (title !== baseline.current.title ||
      body !== baseline.current.body ||
      (!assignmentIncomplete && assignees !== baseline.current.assignees));
  let dirtyFields = false;
  try {
    dirtyFields = board.viewerCanUpdate && fieldChanges(board, item, values).length > 0;
  } catch {
    // Keep invalid raw input visible and let explicit Save show its validation error.
    dirtyFields = board.viewerCanUpdate && Object.keys(values).length > 0;
  }
  return (
    <>
      <div className="gp-detail-links">
        <Copy
          text={
            item.repository && item.number
              ? item.repository + "#" + item.number
              : item.itemId
          }
        />
        {item.url && <UrlLink href={item.url}>{t("Открыть в GitHub")}</UrlLink>}
      </div>
      {[...new Set([...item.warnings, ...(detail?.warnings || [])])].map(
        (w) => (
          <p className="gp-warning" key={w}>
            {localize(w)}
          </p>
        ),
      )}
      {error && (
        <div role="alert" className="gp-warning">
          {localize(error)}{" "}
          <IconButton
            icon="RefreshCw"
            label={t("Обновить задачу")}
            busyLabel={t("Обновление задачи")}
            busy={loading}
            disabled={pending}
            onClick={() => void load()}
          />
          <p>{t("Перед повторной записью проверьте GitHub: часть изменений могла сохраниться.")}</p>
        </div>
      )}
      {saved && (
        <p className="gp-notice" role="status">
          {localize(saved)}
        </p>
      )}
      <form onSubmit={save}>
        <fieldset disabled={pending || commentBusy || !canEdit || !detail}>
          <label>{t("Название")}<input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={1024}
            />
          </label>
          <label>{t("Описание / ожидаемый результат")}<textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
            />
          </label>
          <label>{t("Исполнители · GitHub logins")}<input
              disabled={assignmentIncomplete}
              value={assignees}
              onChange={(e) => setAssignees(e.target.value)}
              placeholder="login, another-login"
              list="gp-assignee-options"
            />
          </label>
          <datalist id="gp-assignee-options">
            {[
              ...new Set(
                board.items.flatMap((t) => t.assignees.map((a) => a.login)),
              ),
            ].map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </fieldset>
        <ProjectFieldEditor board={board} item={item} drafts={values} onChange={setValues} disabled={pending||commentBusy||!board.viewerCanUpdate}/>
        <button
          className="gp-primary"
          disabled={pending || commentBusy || (!dirtyContent && !dirtyFields)}
        >
          {pending ? t("Сохранение…") : t("Сохранить в GitHub")}
        </button>
      </form>
      {!canEdit && (
        <p className="gp-muted">{t("У текущего GitHub-аккаунта нет прав на изменение этой задачи.")}</p>
      )}
      <section className="gp-detail-section">
        <h3>{t("Другие поля GitHub")}</h3>
        {[
          ...Object.entries(item.text).filter(([name])=>!editableFields(board).some(field=>field.name===name)),
          ...Object.entries(item.numbers).filter(([name])=>!editableFields(board).some(field=>field.name===name)),
        ].map(([k, v]) => (
          <p key={k}>
            <strong>{k}:</strong> {v}
          </p>
        ))}
        <p className="gp-muted">{t("Проверка агентом и приёмка человеком отображаются только при наличии соответствующих полей в GitHub.")}</p>
      </section>
      {detail?.linkedPullRequests.length ? (
        <section className="gp-detail-section">
          <h3>{t("Связанные pull request")}</h3>
          {detail.linkedPullRequests.map((pr) => (
            <div key={pr.id}>
              <UrlLink href={pr.url}>
                #{pr.number} · {pr.title}
              </UrlLink>
              <Copy text={pr.repository + "#" + pr.number} />
            </div>
          ))}
        </section>
      ) : null}
      <TaskComments
        rpc={rpc}
        projectKey={snapshot.key}
        item={item}
        detail={detail}
        loading={loading}
        blocked={pending}
        onLoadMore={() => void load(detail?.commentsCursor || undefined)}
        onPosting={commentPending}
        onPosted={async (result) => {
          setSaved(
            result.warning
              ? result.message + " " + result.warning
              : result.message,
          );
          await onDone(result);
          await load();
        }}
      />
    </>
  );
}
function CreateTask({
  workspace,
  projectKey,
  rpc,
  onDone,
  onPending,
}: {
  workspace: Workspace;
  projectKey: string;
  rpc: Rpc;
  onDone: (r: MutationResult) => Promise<void>;
  onPending: (pending: boolean) => void;
}) {
  const { t, localize } = useI18n();
  const creatable = workspace.projects.filter((p) => p.board);
  const repositoryFor = (key: string) =>
    suggestedRepository(
      creatable.find((p) => p.key === key)?.board,
      workspace.defaultRepository,
    );
  // From "All projects" / "My tasks" there is no current project: preselect the
  // first one so the visible option and the submitted value agree.
  const initialTarget =
    creatable.find((p) => p.key === projectKey)?.key ?? creatable[0]?.key ?? "";
  const [target, setTarget] = useState(initialTarget),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [assignees, setAssignees] = useState(""),
    [repository, setRepository] = useState(() => repositoryFor(initialTarget)),
    [repositoryEdited, setRepositoryEdited] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [fieldDrafts,setFieldDrafts]=useState<Record<string,string>>({});
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    onPending(true);
    setError("");
    try {
      const selectedBoard=creatable.find(p=>p.key===target)?.board;
      if(!selectedBoard)throw new Error("Поле недоступно для редактирования. Обновите проект.");
      const fields=fieldChanges(selectedBoard,null,fieldDrafts);
      const r = await rpc.call("item_create", {
        projectKey: target,
        title,
        body,
        assignees: logins(assignees),
        repository: repository.trim() || null,
        fields,
      });
      onPending(false);
      await onDone(r);
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
      onPending(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={pending}>
        <label>{t("Название")}<input
            required
            value={title}
            maxLength={1024}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>{t("Описание / ожидаемый результат")}<textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
          />
        </label>
        <label>{t("Исполнители · GitHub logins")}<input
            value={assignees}
            onChange={(e) => setAssignees(e.target.value)}
            placeholder="login, another-login"
          />
        </label>
        <label>{t("Проект")}<select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setFieldDrafts({});
              if (!repositoryEdited)
                setRepository(repositoryFor(e.target.value));
            }}
          >
            {creatable.map((p) => (
              <option key={p.key} value={p.key}>
                {p.board?.title}
              </option>
            ))}
          </select>
        </label>
        <label>{t("Репозиторий · необязательно")}<input
            value={repository}
            onChange={(e) => {
              setRepository(e.target.value);
              setRepositoryEdited(true);
            }}
            placeholder="owner/repository"
          />
        </label>
        {creatable.find(p=>p.key===target)?.board&&<section><h3>{t("Поля проекта")}</h3><ProjectFieldEditor board={creatable.find(p=>p.key===target)!.board!} item={null} drafts={fieldDrafts} onChange={setFieldDrafts} disabled={pending||!creatable.find(p=>p.key===target)?.board?.viewerCanUpdate}/></section>}
        <p className="gp-muted">
          {!workspace.projects.find((p) => p.key === target)?.board
            ?.viewerCanUpdate
            ? t("У текущего аккаунта нет прав изменять этот проект. ")
            : ""}
          {repository.trim()
            ? t("Будет создана issue в репозитории и добавлена в проект.")
            : t("Будет создан черновик в GitHub Projects. У черновиков нет комментариев.")}
        </p>
        {error && (
          <div role="alert" className="gp-warning">
            {localize(error)}
            <p>{t("Перед повторной отправкой проверьте проект в GitHub, чтобы не создать дубликат.")}</p>
          </div>
        )}
        <button
          className="gp-primary"
          disabled={
            pending ||
            !target ||
            !workspace.projects.find((p) => p.key === target)?.board
              ?.viewerCanUpdate
          }
        >
          {pending
            ? t("Создание…")
            : repository.trim()
              ? t("Создать issue в GitHub")
              : t("Создать черновик в GitHub")}
        </button>
      </fieldset>
    </form>
  );
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "github-projects-workspace",
    title: "Projects",
    icon: "Github",
    path: "workspace",
    component: (props) => <I18nProvider><WorkspacePage {...props}/></I18nProvider>,
  });
});

/** Local UI state only: never task drafts, comments, credentials or GitHub writes. */
export type ViewRoute = {
  page: string;
  view: "list" | "board";
  q: string;
  assignee: string;
  status: string;
  sort: string;
  task: string;
  project: string;
  dateFields: Record<string, string>;
};
export const blankRoute: ViewRoute = {
  page: "all",
  view: "list",
  q: "",
  assignee: "",
  status: "",
  sort: "project",
  task: "",
  project: "",
  dateFields: {},
};
export const viewKeys = {
  route: "bb-github-projects:last-route",
  dates: "bb-github-projects:date-fields",
  views: "bb-github-projects:views",
  visible: "bb-github-projects:visible",
  scroll: "bb-github-projects:scroll-v1",
};
export function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([k, v]) => k.length < 200 && typeof v === "string" && v.length < 200,
    ),
  ) as Record<string, string>;
}
export function viewMap(value: unknown): Record<string, "list" | "board"> {
  return Object.fromEntries(
    Object.entries(stringMap(value)).filter(
      ([, v]) => v === "list" || v === "board",
    ),
  ) as Record<string, "list" | "board">;
}
export function visibility(value: unknown): {
  assignee: boolean;
  date: boolean;
} {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    assignee: typeof raw.assignee === "boolean" ? raw.assignee : true,
    date: typeof raw.date === "boolean" ? raw.date : true,
  };
}
/** Null distinguishes malformed/base navigation from a real explicit route to All. */
export function decodeViewRoute(path: unknown): ViewRoute | null {
  if (typeof path !== "string" || path.length > 16000) return null;
  let candidate = path;
  for (let i = 0; i < 3; i++) {
    try {
      const raw = JSON.parse(candidate);
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        typeof raw.page !== "string" ||
        !raw.page ||
        raw.page.length > 2000
      )
        return null;
      const clean = { ...blankRoute, dateFields: stringMap(raw.dateFields) };
      for (const key of [
        "page",
        "q",
        "assignee",
        "status",
        "sort",
        "task",
        "project",
      ] as const)
        if (typeof raw[key] === "string" && raw[key].length <= 2000)
          clean[key] = raw[key];
      clean.view = raw.view === "board" ? "board" : "list";
      clean.sort = ["project", "title", "date"].includes(clean.sort)
        ? clean.sort
        : "project";
      return clean;
    } catch {
      try {
        const decoded = decodeURIComponent(candidate);
        if (decoded === candidate) return null;
        candidate = decoded;
      } catch {
        return null;
      }
    }
  }
  return null;
}
export function initialViewRoute(path: unknown, saved: unknown): ViewRoute {
  return (
    decodeViewRoute(path) ??
    decodeViewRoute(JSON.stringify(saved)) ?? { ...blankRoute, dateFields: {} }
  );
}
export type ScrollPosition = {
  main: number;
  board: number;
  outer: number;
  sidebar: number;
};
export function scrollPosition(value: unknown): ScrollPosition {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const finite = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0
      ? Math.min(v, 10000000)
      : 0;
  return {
    main: finite(raw.main),
    board: finite(raw.board),
    outer: finite(raw.outer),
    sidebar: finite(raw.sidebar),
  };
}

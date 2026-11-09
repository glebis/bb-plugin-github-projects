/** Browser-only board presentation. These helpers never update GitHub fields. */
export type ColumnLayout = { order: string[]; collapsed: string[] };
/** The synthetic group has a stable ID across interface languages. */
export function defaultColumnOrder(source: string[]): string[] {
  const unique = [...new Set(source)];
  return [...unique.filter(name => name !== "Без статуса"), ...unique.filter(name => name === "Без статуса")];
}
const MAX_COLUMNS = 200;
const MAX_LAYOUTS = 100;
const validName = (name: unknown): name is string => typeof name === "string" && name.length > 0 && name.length <= 2000;
function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, MAX_COLUMNS).filter(validName))];
}
export function sanitizeLayouts(value: unknown): Record<string, ColumnLayout> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: [string, ColumnLayout][] = [];
  for (const [key, layout] of Object.entries(value).slice(0, MAX_LAYOUTS)) {
    if (!validName(key) || !layout || typeof layout !== "object" || Array.isArray(layout)) continue;
    const candidate = layout as Record<string, unknown>;
    result.push([key, { order: names(candidate.order), collapsed: names(candidate.collapsed) }]);
  }
  return Object.fromEntries(result);
}
/** Retained columns keep local order; new GitHub options appear in source order. */
export function resolveColumnOrder(source: string[], layout?: ColumnLayout): string[] {
  const unique = [...new Set(source)];
  const remaining = new Set(unique);
  const ordered = (layout?.order ?? []).filter(name => remaining.delete(name));
  return [...ordered, ...unique.filter(name => remaining.has(name))];
}
/** Move a header without losing any other column or changing its collapse state. */
export function moveColumn(source: string[], from: string, to: string, placement: "before" | "after"): string[] {
  if (from === to || !source.includes(from) || !source.includes(to)) return [...source];
  const result = source.filter(name => name !== from);
  const target = result.indexOf(to) + (placement === "after" ? 1 : 0);
  result.splice(target, 0, from);
  return result;
}
export function toggleCollapsed(layout: ColumnLayout, column: string): ColumnLayout {
  return {
    order: [...layout.order],
    collapsed: layout.collapsed.includes(column) ? layout.collapsed.filter(name => name !== column) : [...new Set([...layout.collapsed, column])],
  };
}

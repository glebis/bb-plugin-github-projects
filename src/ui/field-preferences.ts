import type { ProjectBoard, ProjectItem } from "../contracts";
import { editableFields, fieldInputValue, type ProjectField } from "./project-fields";

export const fieldPreferencesKey = "bb-github-projects:custom-fields-v1";
export const unsetFieldFilter = ":unset";
export type FilterValue = string | string[];
export type FieldFilters = Record<string, FilterValue>;
export type FieldPreferences = { visible?: string[]; filters: FieldFilters };
const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 200;
export function sanitizeFieldPreferences(value: unknown): Record<string, FieldPreferences> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 100).flatMap(([key, raw]) => {
    if (!validId(key) || !raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const entry = raw as Record<string, unknown>;
    const filters: FieldFilters = {};
    if (entry.filters && typeof entry.filters === "object" && !Array.isArray(entry.filters)) {
      for (const [id, input] of Object.entries(entry.filters).slice(0, 100)) {
        if (!validId(id)) continue;
        if (typeof input === "string" && input.length <= 1024) Object.defineProperty(filters, id, { value: input, enumerable: true, configurable: true, writable: true });
        else if (Array.isArray(input)) Object.defineProperty(filters, id, { value: [...new Set(input.slice(0, 100).filter(validId))], enumerable: true, configurable: true, writable: true });
      }
    }
    return [[key, { filters, ...(Array.isArray(entry.visible) ? { visible: [...new Set(entry.visible.slice(0, 100).filter(validId))] } : {}) }]];
  }));
}
export function customFields(board: ProjectBoard) {
  return editableFields(board).filter(field => field.id !== board.statusField?.id);
}
export function visibleFields(board: ProjectBoard, preferences?: FieldPreferences) {
  return customFields(board).filter(field => preferences?.visible === undefined || preferences.visible.includes(field.id));
}
/** Selected options are ORed within a field; unknown/deleted IDs never trap a view. */
function activeFilter(field: ProjectField, filter: FilterValue | undefined): FilterValue | null {
  if (field.dataType === "SINGLE_SELECT") {
    const selections = Array.isArray(filter) ? filter : filter ? [filter] : [];
    const valid = [...new Set(selections.filter(value => value === unsetFieldFilter || field.options?.some(option => option.id === value)))];
    return valid.length ? valid : null;
  }
  if (typeof filter !== "string" || !filter) return null;
  if (filter === unsetFieldFilter) return filter;
  if (field.dataType === "NUMBER" && (!filter.trim() || !Number.isFinite(Number(filter)))) return null;
  if (field.dataType === "DATE" && (!/^\d{4}-\d{2}-\d{2}$/.test(filter) || !Number.isFinite(Date.parse(filter + "T12:00:00Z")) || new Date(filter + "T12:00:00Z").toISOString().slice(0, 10) !== filter)) return null;
  return filter;
}
/** Filters are ANDed across fields; generic text/number/date criteria remain scalar. */
export function matchesFieldFilters(board: ProjectBoard, item: ProjectItem, filters: FieldFilters): boolean {
  return customFields(board).every(field => {
    const filter = activeFilter(field, filters[field.id]);
    if (filter === null) return true;
    const value = fieldInputValue(field, item);
    if (Array.isArray(filter)) return filter.some(selection => selection === unsetFieldFilter ? value === "" : value === selection);
    if (filter === unsetFieldFilter) return value === "";
    if (field.dataType === "NUMBER") return value !== "" && Number(value) === Number(filter);
    if (field.dataType === "DATE") return value === filter;
    return value.toLocaleLowerCase().includes(filter.toLocaleLowerCase());
  });
}
export function toggleFieldFilter(current: FilterValue | undefined, optionId: string): string[] {
  const selected = [...new Set(Array.isArray(current) ? current : current ? [current] : [])];
  return selected.includes(optionId) ? selected.filter(value => value !== optionId) : [...selected, optionId];
}
export function activeFieldFilterCount(board: ProjectBoard, filters: FieldFilters): number {
  return customFields(board).filter(field => activeFilter(field, filters[field.id]) !== null).length;
}

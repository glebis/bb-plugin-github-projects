import type { ProjectBoard, ProjectItem } from "../contracts";
import { editableFields, fieldInputValue } from "./project-fields";

export const fieldPreferencesKey = "bb-github-projects:custom-fields-v1";
export const unsetFieldFilter = ":unset";
export type FieldPreferences = { visible?: string[]; filters: Record<string, string> };
export function sanitizeFieldPreferences(value: unknown): Record<string, FieldPreferences> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 100).flatMap(([key, raw]) => {
    if (!key || key.length > 200 || !raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const entry = raw as Record<string, unknown>;
    const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 200;
    const filters = entry.filters && typeof entry.filters === "object" && !Array.isArray(entry.filters)
      ? Object.fromEntries(Object.entries(entry.filters).slice(0, 100).filter(([id, input]) => validId(id) && typeof input === "string" && input.length <= 1024)) as Record<string, string> : {};
    return [[key, { filters, ...(Array.isArray(entry.visible) ? { visible: [...new Set(entry.visible.filter(validId))].slice(0, 100) } : {}) }]];
  }));
}
export function customFields(board: ProjectBoard) {
  return editableFields(board).filter(field => field.id !== board.statusField?.id);
}
export function visibleFields(board: ProjectBoard, preferences?: FieldPreferences) {
  return customFields(board).filter(field => preferences?.visible === undefined || preferences.visible.includes(field.id));
}
/** Filters belong to field IDs; old/removed definitions never trap a view with invisible filters. */
export function matchesFieldFilters(board: ProjectBoard, item: ProjectItem, filters: Record<string, string>): boolean {
  return customFields(board).every(field => {
    const filter = filters[field.id];
    if (!filter) return true;
    const value = fieldInputValue(field, item);
    if (filter === unsetFieldFilter) return value === "";
    if (field.dataType === "SINGLE_SELECT") return !field.options?.some(option => option.id === filter) || value === filter;
    if (field.dataType === "NUMBER") return value !== "" && Number.isFinite(Number(filter)) && Number(value) === Number(filter);
    if (field.dataType === "DATE") return value === filter;
    return value.toLocaleLowerCase().includes(filter.toLocaleLowerCase());
  });
}

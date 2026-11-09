import {
  targetSchema,
  fieldValueSchema,
  type ProjectTarget,
  type ProjectBoard,
  type ProjectItem,
} from "./contracts.js";

export function projectKey(target: ProjectTarget): string {
  return `${target.owner.toLowerCase()}:${target.number}`;
}

export function projectUrl(target: ProjectTarget): string {
  return `https://github.com/${target.ownerKind === "organization" ? "orgs" : "users"}/${target.owner}/projects/${target.number}`;
}

export function parseProjectUrls(value: string): ProjectTarget[] {
  const targets = new Map<string, ProjectTarget>();
  for (const raw of value.split(/[\s,]+/).filter(Boolean)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`Некорректная ссылка проекта: ${raw}`);
    }
    const match = url.pathname.match(
      /^\/(orgs|users)\/([^/]+)\/projects\/(\d+)\/?$/,
    );
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      !match
    ) {
      throw new Error(
        "Используйте ссылку https://github.com/orgs/…/projects/… или https://github.com/users/…/projects/…",
      );
    }
    const target = targetSchema.parse({
      owner: match[2],
      number: Number(match[3]),
      ownerKind: match[1] === "orgs" ? "organization" : "user",
    });
    targets.set(projectKey(target), target);
  }
  if (targets.size > 25) throw new Error("Подключите не более 25 проектов.");
  return [...targets.values()];
}

export function parseRepository(value: string | null): string | null {
  const repository = value?.trim();
  if (!repository) return null;
  if (
    !/^[a-z\d-]+\/[a-z\d._-]+$/i.test(repository) ||
    repository.length > 200
  ) {
    throw new Error("Укажите репозиторий в формате владелец/название.");
  }
  return repository;
}

export function getItem(board: ProjectBoard, itemId: string): ProjectItem {
  const item = board.items.find((candidate) => candidate.itemId === itemId);
  if (!item)
    throw new Error("Задача не найдена в этом проекте. Обновите список.");
  if (!item.contentId || item.kind === "Unknown")
    throw new Error("Содержимое задачи недоступно этой учётной записи GitHub.");
  return item;
}

export function validateFieldChange(
  board: ProjectBoard,
  fieldId: string,
  value: {
    singleSelectOptionId?: string;
    date?: string;
    text?: string;
    number?: number;
  } | null,
): void {
  const field = board.fields.find((candidate) => candidate.id === fieldId);
  if (!field)
    throw new Error("Поле не принадлежит выбранному проекту. Обновите проект.");
  if (!["SINGLE_SELECT", "DATE", "TEXT", "NUMBER"].includes(field.dataType))
    throw new Error("Это поле GitHub недоступно для редактирования.");
  if (!fieldValueSchema.safeParse(value).success)
    throw new Error("Неподдерживаемое значение поля.");
  if (value === null) return;
  if ("singleSelectOptionId" in value) {
    if (
      field.dataType !== "SINGLE_SELECT" ||
      !field.options?.some((option) => option.id === value.singleSelectOptionId)
    )
      throw new Error("Значение отсутствует среди вариантов поля GitHub.");
  } else if ("date" in value) {
    const date = value.date!;
    if (
      field.dataType !== "DATE" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
      new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
    )
      throw new Error("Поле должно содержать существующую дату.");
  } else if ("text" in value) {
    if (field.dataType !== "TEXT")
      throw new Error("Это поле GitHub не является текстовым.");
  } else if ("number" in value) {
    if (field.dataType !== "NUMBER" || !Number.isFinite(value.number))
      throw new Error("Это поле GitHub не является числовым.");
  } else throw new Error("Неподдерживаемое значение поля.");
}

/**
 * Repository to suggest when creating an issue in a project: the one most of
 * the project's existing issues live in. Falls back to the workspace default
 * only when the project has no repository-backed items yet, so a project
 * never inherits another project's repository by accident.
 */
export function suggestedRepository(
  board: Pick<ProjectBoard, "items"> | null | undefined,
  fallback: string,
): string {
  const counts = new Map<string, number>();
  for (const item of board?.items ?? [])
    if (item.repository)
      counts.set(item.repository, (counts.get(item.repository) ?? 0) + 1);
  let best = "";
  for (const [repository, count] of counts)
    if (count > (counts.get(best) ?? 0)) best = repository;
  return best || fallback;
}

import type { ProjectSnapshot, Workspace } from "../contracts";

export type LocalStatus = {
  projectKey: string;
  itemId: string;
  fieldName: string;
  value: string | null;
};

/** Overlay only the pending field; preserve concurrent changes to all other data. */
export function withLocalStatus(
  workspace: Workspace,
  change: LocalStatus,
): Workspace {
  return {
    ...workspace,
    projects: workspace.projects.map((snapshot) => {
      if (snapshot.key !== change.projectKey || !snapshot.board)
        return snapshot;
      return {
        ...snapshot,
        board: {
          ...snapshot.board,
          items: snapshot.board.items.map((item) => {
            if (item.itemId !== change.itemId) return item;
            const singleSelect = { ...item.singleSelect };
            if (change.value === null) delete singleSelect[change.fieldName];
            else singleSelect[change.fieldName] = change.value;
            return { ...item, singleSelect };
          }),
        },
      };
    }),
  };
}

/** Resolve a column against the dragged item's own project, including My tasks. */
export function statusMove(
  snapshot: ProjectSnapshot,
  itemId: string,
  column: string,
) {
  const board = snapshot.board;
  if (!board || snapshot.stale || snapshot.problem)
    throw new Error("Сначала обновите проект.");
  if (!board.viewerCanUpdate)
    throw new Error("Нет прав изменять статусы этого проекта.");
  const field = board.statusField;
  if (!field) throw new Error("У проекта нет поля статуса.");
  const item = board.items.find((candidate) => candidate.itemId === itemId);
  if (!item) throw new Error("Задача больше не найдена в проекте.");
  const option = field.options.find((candidate) => candidate.name === column);
  if (column === "Без статуса" && option)
    throw new Error(
      "Название статуса совпадает с пустой группой. Измените статус через карточку задачи.",
    );
  if (column !== "Без статуса" && !option)
    throw new Error("В проекте этой задачи нет такого статуса.");
  const current = item.singleSelect[field.name] || "Без статуса";
  if (current === column) return null;
  return {
    projectKey: snapshot.key,
    itemId,
    fields: [
      {
        fieldId: field.id,
        value: option ? { singleSelectOptionId: option.id } : null,
      },
    ],
  };
}

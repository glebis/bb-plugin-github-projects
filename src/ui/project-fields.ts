import type { ProjectBoard, ProjectItem } from '../contracts';

export type ProjectField = ProjectBoard['fields'][number];
export type FieldDrafts = Record<string, string>;
export type FieldChange = {
  fieldId: string;
  value: { text: string } | { number: number } | { date: string }
    | { singleSelectOptionId: string } | null;
};
const supported = new Set(['TEXT', 'NUMBER', 'DATE', 'SINGLE_SELECT']);

export function editableFields(board: Pick<ProjectBoard, 'fields'>): ProjectField[] {
  return board.fields.filter(field => supported.has(field.dataType) && field.name !== 'Title');
}

export function fieldInputValue(field: ProjectField, item: ProjectItem | null): string {
  if (!item) return '';
  if (field.dataType === 'SINGLE_SELECT') {
    return field.options?.find(option => option.name === item.singleSelect[field.name])?.id || '';
  }
  if (field.dataType === 'NUMBER') {
    return item.numbers[field.name] === undefined ? '' : String(item.numbers[field.name]);
  }
  return item.text[field.name] ?? '';
}

export function fieldDisplayValue(field: ProjectField, item: ProjectItem): string {
  if (field.dataType === 'SINGLE_SELECT') return item.singleSelect[field.name] || '';
  return fieldInputValue(field, item);
}

/** Validate all touched inputs before any caller starts a GitHub write. */
export function fieldChanges(
  board: Pick<ProjectBoard, 'fields'>,
  item: ProjectItem | null,
  drafts: FieldDrafts,
): FieldChange[] {
  const fields = editableFields(board);
  return Object.entries(drafts).flatMap(([fieldId, input]) => {
    const field = fields.find(candidate => candidate.id === fieldId);
    if (!field) throw new Error('Поле недоступно для редактирования. Обновите проект.');
    const baseline = fieldInputValue(field, item);
    if (input === baseline) return [];
    let value: FieldChange['value'];
    if (input === '') {
      value = null;
    } else if (field.dataType === 'TEXT') {
      if (input.length > 1024) throw new Error('Текст поля не должен превышать 1024 символа.');
      value = { text: input };
    } else if (field.dataType === 'NUMBER') {
      const raw = input.trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) {
        throw new Error('Введите конечное число с точкой в качестве десятичного разделителя.');
      }
      const number = Number(raw);
      if (baseline !== '' && Number(baseline) === number) return [];
      value = { number };
    } else if (field.dataType === 'DATE') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || !Number.isFinite(Date.parse(input + 'T12:00:00Z'))
        || new Date(input + 'T12:00:00Z').toISOString().slice(0, 10) !== input) {
        throw new Error('Введите существующую дату.');
      }
      value = { date: input };
    } else {
      if (!field.options?.some(option => option.id === input)) {
        throw new Error('Выберите существующий вариант поля GitHub.');
      }
      value = { singleSelectOptionId: input };
    }
    return [{ fieldId, value }];
  });
}

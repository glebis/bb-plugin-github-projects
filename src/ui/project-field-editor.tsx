import type { ProjectBoard, ProjectItem } from '../contracts';
import { useI18n } from './i18n';
import { editableFields, fieldInputValue, type FieldDrafts } from './project-fields';

type Props = {
  board: ProjectBoard;
  item: ProjectItem | null;
  drafts: FieldDrafts;
  onChange: (drafts: FieldDrafts) => void;
  disabled?: boolean;
};

export function ProjectFieldEditor({ board, item, drafts, onChange, disabled = false }: Props) {
  const { t } = useI18n();
  return (
    <fieldset disabled={disabled}>
      <div className="gp-fields">
        {editableFields(board).map(field => {
          const value = drafts[field.id] ?? fieldInputValue(field, item);
          const change = (next: string) => onChange({ ...drafts, [field.id]: next });
          return (
            <label key={field.id} data-project-field={field.id}>
              {field.name}
              {field.dataType === 'SINGLE_SELECT' ? (
                <select value={value} onChange={event => change(event.target.value)}>
                  <option value="">{t('Не задано')}</option>
                  {field.options?.map(option => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.dataType === 'DATE' ? 'date' : 'text'}
                  inputMode={field.dataType === 'NUMBER' ? 'decimal' : undefined}
                  maxLength={field.dataType === 'TEXT' ? 1024 : undefined}
                  value={value}
                  onChange={event => change(event.target.value)}
                  aria-description={field.dataType === 'NUMBER'
                    ? t('Число с точкой в качестве десятичного разделителя.') : undefined}
                />
              )}
              {field.dataType === 'NUMBER' && <small>{t('Число с точкой в качестве десятичного разделителя.')}</small>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

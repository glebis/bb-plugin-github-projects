import { useEffect, useId, useRef, useState } from 'react';
import { useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../contracts';
import { useI18n } from './i18n';
import { mergeAssigneeUsers, toggleAssignee, type AssigneeUser } from './assignee-options';

type Props = {
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  projectKey: string;
  repository: string | null;
  selected: string[];
  knownUsers: AssigneeUser[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
};

export function AssigneeSelect({ rpc, projectKey, repository, selected, knownUsers, onChange, disabled = false }: Props) {
  const { t, localize } = useI18n();
  const id = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), search = useRef<HTMLInputElement>(null);
  const serial = useRef(0);
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [remote, setRemote] = useState<{ context: string; users: AssigneeUser[] } | null>(null);
  const [loading, setLoading] = useState(false), [failure, setFailure] = useState(''), [failureContext, setFailureContext] = useState('');
  const lookupQuery = query.trim().replace(/^@/, '');
  const context = JSON.stringify([projectKey, repository, lookupQuery]);
  const currentFailure = failureContext === context ? failure : '';
  const users = mergeAssigneeUsers(selected, knownUsers, remote?.context === context ? remote.users : []);
  const selectedUsers = users.filter(user => selected.some(login => login.toLowerCase() === user.login.toLowerCase()));
  const verified = new Set((remote?.context === context ? remote.users : []).map(user => user.login.toLowerCase()));
  const available = users.filter(user => !selectedUsers.includes(user)
    && (!repository || !!currentFailure || verified.has(user.login.toLowerCase()))
    && (user.login + ' ' + (user.name || '')).toLowerCase().includes(lookupQuery.toLowerCase()));

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  }
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
    document.addEventListener('pointerdown', outside);
    // Handle this before the task dialog's document-level Escape listener.
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  useEffect(() => { setOpen(false); setQuery(''); setRemote(null); setFailure(''); }, [projectKey, repository]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    const request = ++serial.current;
    if (!open || disabled) { setLoading(false); return; }
    setLoading(true);
    setFailure('');
    const timer = setTimeout(() => {
      rpc.call('assignees_list', { projectKey, repository, query: lookupQuery }).then(result => {
        if (serial.current !== request) return;
        setRemote({ context, users: result.users });
        setLoading(false);
      }, error => {
        if (serial.current !== request) return;
        setFailureContext(context);
        setFailure(error instanceof Error ? error.message : String(error));
        setLoading(false);
      });
    }, 250);
    return () => { clearTimeout(timer); serial.current++; };
  }, [rpc, projectKey, repository, lookupQuery, context, open, disabled]);

  function option(user: AssigneeUser, checked: boolean) {
    return <label className="gp-assignee-option" key={user.login.toLowerCase()} data-assignee-login={user.login.toLowerCase()}>
      <input type="checkbox" checked={checked} disabled={disabled || (!checked && selected.length >= 10)}
        onChange={() => {
          onChange(toggleAssignee(selected, user.login));
          // The row moves between selected and available; preserve keyboard focus.
          requestAnimationFrame(() => {
            const row = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-assignee-login]') ?? [])
              .find(element => element.dataset.assigneeLogin === user.login.toLowerCase());
            (row?.querySelector<HTMLInputElement>('input') ?? search.current)?.focus();
          });
        }} />
      {user.avatarUrl && <img src={user.avatarUrl} alt="" width={24} height={24} />}
      <span><strong>{user.name || user.login}</strong><small>@{user.login}</small></span>
    </label>;
  }
  return <div className="gp-assignee-select" ref={root} onKeyDown={event => {
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
  }}>
    <span id={id + '-label'} className="gp-assignee-label">{t('Исполнители')}</span>
    <button type="button" className="gp-assignee-trigger" ref={trigger} disabled={disabled}
      aria-labelledby={id + '-label ' + id + '-value'} aria-expanded={open} aria-controls={id + '-panel'}
      onClick={() => setOpen(value => !value)}>
      <span id={id + '-value'}>{selectedUsers.length ? selectedUsers.map(user => user.name || user.login).join(', ') : t('Не назначен')}</span>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && <div id={id + '-panel'} className="gp-assignee-panel" role="group" aria-labelledby={id + '-label'}>
      <label className="gp-assignee-search">{t('Поиск исполнителей')}<input ref={search} value={query} maxLength={80}
        disabled={disabled} placeholder={t('Имя или GitHub login')} onChange={event => setQuery(event.target.value)} /></label>
      {!!selectedUsers.length && <fieldset className="gp-assignee-selected"><legend>{t('Выбрано — снимите флажок, чтобы убрать')}</legend>{selectedUsers.map(user => option(user, true))}</fieldset>}
      {loading && <p className="gp-assignee-hint" role="status">{t('Поиск в GitHub…')}</p>}
      {!!currentFailure && <p className="gp-assignee-hint" role="status">{t('Не удалось загрузить участников. Доступны известные исполнители.')} {localize(currentFailure)}</p>}
      <div className="gp-assignee-options">{available.map(user => option(user, false))}</div>
      {!loading && !available.length && <p className="gp-assignee-hint">{t('Других исполнителей не найдено. Измените поисковый запрос.')}</p>}
      {remote?.context === context && remote.users.length === 20 && <p className="gp-assignee-hint">{t('Показаны первые 20 результатов. Уточните поиск.')}</p>}
      {selected.length >= 10 && <p className="gp-assignee-hint">{t('Можно назначить не более 10 исполнителей. Снимите флажок, чтобы выбрать другого.')}</p>}
      <button type="button" className="gp-assignee-close" onClick={() => close(true)}>{t('Готово')}</button>
    </div>}
  </div>;
}

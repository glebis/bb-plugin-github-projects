export type AssigneeUser = { login: string; avatarUrl: string | null; name?: string | null };
const key = (login: string) => login.toLowerCase();
/** Merge metadata case-insensitively, retaining selected users absent from results. */
export function mergeAssigneeUsers(selected: readonly string[], ...sources: readonly AssigneeUser[][]): AssigneeUser[] {
  const users = new Map<string, AssigneeUser>();
  for (const source of sources) {
    for (const user of source) {
      const previous = users.get(key(user.login));
      users.set(key(user.login), {
        ...previous, ...user,
        name: user.name || previous?.name || null,
        avatarUrl: user.avatarUrl || previous?.avatarUrl || null,
      });
    }
  }
  for (const login of selected) {
    if (!users.has(key(login))) users.set(key(login), { login, name: null, avatarUrl: null });
  }
  return [...users.values()];
}
export function toggleAssignee(selected: readonly string[], login: string, limit = 10): string[] {
  const unique = [...new Map(selected.map(value => [key(value), value])).values()];
  if (unique.some(value => key(value) === key(login))) return unique.filter(value => key(value) !== key(login));
  return unique.length < limit ? [...unique, login] : unique;
}
/** Selection order and GitHub login casing do not represent an assignment change. */
export function sameAssignees(a: readonly string[], b: readonly string[]): boolean {
  const normalize = (values: readonly string[]) => [...new Set(values.map(key))].sort();
  const left = normalize(a), right = normalize(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

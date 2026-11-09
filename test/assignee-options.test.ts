import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAssigneeUsers, toggleAssignee } from '../src/ui/assignee-options';

test('merge retains selected users absent from search and merges case-insensitively', () => {
  const known = [{ login: 'Anna', name: 'Anna Smith', avatarUrl: 'avatar' }];
  const result = mergeAssigneeUsers(['missing', 'ANNA'], known, [{ login: 'anna', name: null, avatarUrl: null }]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.find(user => user.login.toLowerCase() === 'anna'), { login: 'anna', name: 'Anna Smith', avatarUrl: 'avatar' });
  assert.ok(result.some(user => user.login === 'missing'));
  assert.deepEqual(known, [{ login: 'Anna', name: 'Anna Smith', avatarUrl: 'avatar' }]);
});
test('toggle adds/removes without mutating input or duplicating case variants', () => {
  const selected = ['Anna', 'Bob'];
  assert.deepEqual(toggleAssignee(selected, 'ANNA'), ['Bob']);
  assert.deepEqual(toggleAssignee(selected, 'Carol'), ['Anna', 'Bob', 'Carol']);
  assert.deepEqual(selected, ['Anna', 'Bob']);
});
test('selection limit prevents additions but allows removals', () => {
  const selected = Array.from({ length: 10 }, (_, index) => 'user' + index);
  assert.deepEqual(toggleAssignee(selected, 'extra'), selected);
  assert.equal(toggleAssignee(selected, 'USER3').length, 9);
});
test('assignment equality ignores order, duplicates and case', async () => {
  const { sameAssignees } = await import('../src/ui/assignee-options');
  assert.equal(sameAssignees(['Anna', 'bob', 'anna'], ['BOB', 'ANNA']), true);
  assert.equal(sameAssignees(['Anna'], ['Anna', 'bob']), false);
  assert.equal(sameAssignees([], []), true);
});

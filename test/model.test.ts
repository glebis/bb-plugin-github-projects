import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseProjectUrls,
  parseRepository,
  suggestedRepository,
  validateFieldChange,
} from "../src/model.js";
import type { ProjectBoard } from "../src/contracts.js";
test("project URL parser rejects credentialed, lookalike and non-GitHub URLs", () => {
  for (const url of [
    "https://github.com.evil.test/orgs/acme/projects/1",
    "https://name:secret@github.com/orgs/acme/projects/1",
    "http://github.com/orgs/acme/projects/1",
    "https://github.com/orgs/acme/projects/0",
  ])
    assert.throws(() => parseProjectUrls(url));
  assert.equal(
    parseProjectUrls(
      "https://github.com/orgs/acme/projects/1?pane=issue https://github.com/orgs/ACME/projects/1",
    ).length,
    1,
  );
});
test("repository parser accepts owner/name, rejects URLs and malformed multi-segment values", () => {
  assert.equal(parseRepository(" acme/repo-name "), "acme/repo-name");
  assert.equal(parseRepository(""), null);
  for (const value of [
    "https://github.com/acme/repo",
    "acme/repo/extra",
    "acme/",
    "/repo",
  ])
    assert.throws(() => parseRepository(value));
});
test("field validation rejects impossible dates, foreign options and type mismatches", () => {
  const board = {
    fields: [
      { id: "date", name: "Due", dataType: "DATE" },
      {
        id: "select",
        name: "Status",
        dataType: "SINGLE_SELECT",
        options: [{ id: "todo", name: "Todo" }],
      },
    ],
  } as ProjectBoard;
  validateFieldChange(board, "date", { date: "2028-02-29" });
  for (const date of ["2026-02-29", "2026-02-31", "2026-13-01"])
    assert.throws(() => validateFieldChange(board, "date", { date }));
  assert.throws(() =>
    validateFieldChange(board, "select", { singleSelectOptionId: "foreign" }),
  );
  assert.throws(() => validateFieldChange(board, "date", { text: "text" }));
  assert.throws(() => validateFieldChange(board, "missing", null));
});

test("suggested repository follows the project, not the global default", () => {
  const items = (repos: (string | null)[]) =>
    ({ items: repos.map((repository) => ({ repository })) }) as unknown as ProjectBoard;
  assert.equal(
    suggestedRepository(items(["glebis/cull", null, "glebis/cull", "glebis/x"]), "glebis/workroom"),
    "glebis/cull",
  );
  assert.equal(suggestedRepository(items([null]), "glebis/workroom"), "glebis/workroom");
  assert.equal(suggestedRepository(null, ""), "");
});

test('custom field values validate exact shapes and reject clearing built-in fields', () => {
  const board = { fields: [
    { id: 'text', name: 'Note', dataType: 'TEXT' },
    { id: 'number', name: 'Estimate', dataType: 'NUMBER' },
    { id: 'title', name: 'Title', dataType: 'TITLE' },
  ] } as ProjectBoard;
  for (const number of [0, -2.5, 1.25]) validateFieldChange(board, 'number', { number });
  validateFieldChange(board, 'text', { text: '' });
  validateFieldChange(board, 'text', { text: 'Details' });
  validateFieldChange(board, 'text', null);
  assert.throws(() => validateFieldChange(board, 'title', null));
  for (const value of [{}, { text: 'x', number: 1 }, { text: 42 }, { text: 'x'.repeat(1025) }, { number: Infinity }, { unexpected: true }])
    assert.throws(() => validateFieldChange(board, 'text', value as any));
});

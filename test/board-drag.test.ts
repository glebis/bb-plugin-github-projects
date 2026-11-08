import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotSchema, type ProjectSnapshot } from "../src/contracts.js";
import { statusMove, withLocalStatus } from "../src/ui/board-drag.js";

function snapshot(owner = "acme", fieldName = "Status"): ProjectSnapshot {
  const field = {
    id: `${owner}-field`,
    name: fieldName,
    options: [
      { id: `${owner}-todo`, name: "Todo" },
      { id: `${owner}-done`, name: "Done" },
    ],
  };
  return snapshotSchema.parse({
    key: `${owner}:1`,
    target: { owner, ownerKind: "organization", number: 1 },
    fetchedAt: "2026-11-08T12:00:00Z",
    stale: false,
    problem: null,
    board: {
      id: `${owner}-project`,
      title: owner,
      number: 1,
      url: `https://github.com/orgs/${owner}/projects/1`,
      closed: false,
      description: null,
      viewerCanUpdate: true,
      statusField: field,
      singleSelectFields: [field],
      fields: [{ ...field, dataType: "SINGLE_SELECT" }],
      dateFields: [],
      warnings: [],
      items: [
        {
          itemId: `${owner}-item`,
          contentId: `${owner}-issue`,
          kind: "Issue",
          number: 1,
          title: "Task",
          body: "",
          url: null,
          repository: `${owner}/repo`,
          reference: null,
          state: "OPEN",
          isDraft: false,
          author: "me",
          assignees: [],
          labels: [],
          milestone: null,
          issueType: null,
          updatedAt: null,
          singleSelect: { [fieldName]: "Todo" },
          numbers: {},
          text: {},
          viewerCanUpdate: true,
          warnings: [],
        },
      ],
    },
  });
}

test("My tasks resolves each card's own project field and option IDs", () => {
  const first = snapshot("alpha", "Workflow");
  const second = snapshot("beta", "Delivery stage");
  assert.deepEqual(statusMove(first, "alpha-item", "Done"), {
    projectKey: "alpha:1",
    itemId: "alpha-item",
    fields: [
      { fieldId: "alpha-field", value: { singleSelectOptionId: "alpha-done" } },
    ],
  });
  assert.deepEqual(statusMove(second, "beta-item", "Done"), {
    projectKey: "beta:1",
    itemId: "beta-item",
    fields: [
      { fieldId: "beta-field", value: { singleSelectOptionId: "beta-done" } },
    ],
  });
  assert.equal(
    first.board!.items[0].singleSelect.Workflow,
    "Todo",
    "planning a move must not optimistically mutate cached source",
  );
});

test("same column is a no-op including an already unassigned status", () => {
  const value = snapshot();
  assert.equal(statusMove(value, "acme-item", "Todo"), null);
  value.board!.items[0].singleSelect = {};
  assert.equal(statusMove(value, "acme-item", "Без статуса"), null);
});

test("moving to no status explicitly clears the source project's status field", () => {
  assert.deepEqual(statusMove(snapshot(), "acme-item", "Без статуса"), {
    projectKey: "acme:1",
    itemId: "acme-item",
    fields: [{ fieldId: "acme-field", value: null }],
  });
});

test("rejects columns missing from the source project's schema", () => {
  assert.throws(
    () => statusMove(snapshot(), "acme-item", "In progress"),
    /нет такого статуса/,
  );
});

test("rejects unavailable, stale, failed and project-read-only snapshots", () => {
  for (const change of [
    (value: ProjectSnapshot) => {
      value.board = null;
    },
    (value: ProjectSnapshot) => {
      value.stale = true;
    },
    (value: ProjectSnapshot) => {
      value.problem = "offline";
    },
    (value: ProjectSnapshot) => {
      value.board!.viewerCanUpdate = false;
    },
  ]) {
    const value = snapshot();
    change(value);
    assert.throws(() => statusMove(value, "acme-item", "Done"));
  }
});

test("rejects missing status field and missing project item", () => {
  const value = snapshot();
  value.board!.statusField = null;
  assert.throws(
    () => statusMove(value, "acme-item", "Done"),
    /нет поля статуса/,
  );
  assert.throws(
    () => statusMove(snapshot(), "foreign-item", "Done"),
    /не найдена/,
  );
});

test("project permission allows moving content the viewer cannot edit", () => {
  const value = snapshot();
  value.board!.items[0].viewerCanUpdate = false;
  assert.equal(
    statusMove(value, "acme-item", "Done")?.fields[0].value
      ?.singleSelectOptionId,
    "acme-done",
  );
});

test("rejects an option named like the no-status column as ambiguous", () => {
  const value = snapshot();
  value.board!.statusField!.options.push({
    id: "collision",
    name: "Без статуса",
  });
  assert.throws(
    () => statusMove(value, "acme-item", "Без статуса"),
    /совпадает с пустой группой/,
  );
});

test("optimistic status overlay survives a stale read without mutating the source", () => {
  const first = snapshot();
  first.board!.items[0].singleSelect.Priority = "High";
  const other = snapshot("other");
  const original = {
    viewerLogin: "me",
    projects: [first, other],
    configured: true,
    defaultRepository: "",
    problem: null,
  };
  const change = {
    projectKey: first.key,
    itemId: "acme-item",
    fieldName: "Status",
    value: "Done",
  };
  const optimistic = withLocalStatus(original, change);
  assert.equal(
    optimistic.projects[0].board!.items[0].singleSelect.Status,
    "Done",
  );
  assert.equal(first.board!.items[0].singleSelect.Status, "Todo");
  assert.equal(optimistic.projects[1], other);
  const refreshed = structuredClone(original);
  refreshed.projects[0].board!.items[0].body = "Concurrent description change";
  const overlaid = withLocalStatus(refreshed, change);
  assert.equal(
    overlaid.projects[0].board!.items[0].singleSelect.Status,
    "Done",
  );
  const rolledBack = withLocalStatus(overlaid, { ...change, value: "Todo" });
  assert.equal(
    rolledBack.projects[0].board!.items[0].singleSelect.Status,
    "Todo",
  );
  assert.equal(
    rolledBack.projects[0].board!.items[0].body,
    "Concurrent description change",
  );
  assert.equal(
    rolledBack.projects[0].board!.items[0].singleSelect.Priority,
    "High",
  );
});

test("optimistic move can clear status and roll back to an absent status", () => {
  const project = snapshot();
  const workspace = {
    viewerLogin: "me",
    projects: [project],
    configured: true,
    defaultRepository: "",
    problem: null,
  };
  const ref = {
    projectKey: project.key,
    itemId: "acme-item",
    fieldName: "Status",
  };
  const cleared = withLocalStatus(workspace, { ...ref, value: null });
  assert.equal(
    Object.hasOwn(cleared.projects[0].board!.items[0].singleSelect, "Status"),
    false,
  );
  const moved = withLocalStatus(cleared, { ...ref, value: "Done" });
  const reverted = withLocalStatus(moved, { ...ref, value: null });
  assert.equal(
    Object.hasOwn(reverted.projects[0].board!.items[0].singleSelect, "Status"),
    false,
  );
});

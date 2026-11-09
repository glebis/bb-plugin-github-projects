import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultColumnOrder, sanitizeLayouts, resolveColumnOrder, moveColumn, toggleCollapsed } from "../src/ui/column-layout.js";

test("Without status is last by default while an explicitly saved layout wins", () => {
  const source = ["Без статуса", "Todo", "In Progress", "Done", "Review", "Todo"];
  const defaults = defaultColumnOrder(source);
  assert.deepEqual(defaults, ["Todo", "In Progress", "Done", "Review", "Без статуса"]);
  assert.deepEqual(resolveColumnOrder(defaults), defaults);
  assert.deepEqual(resolveColumnOrder(defaults, {order:["Без статуса", "Done"], collapsed:["Без статуса"]}), ["Без статуса", "Done", "Todo", "In Progress", "Review"]);
  assert.equal(source[0], "Без статуса");
});

test("saved order ignores removed statuses, deduplicates, and appends new statuses in GitHub order", () => {
  const layout = { order: ["Done", "Removed", "Todo", "Done"], collapsed: ["Done"] };
  assert.deepEqual(resolveColumnOrder(["No status", "Todo", "Review", "Done", "New", "Todo"], layout), ["Done", "Todo", "No status", "Review", "New"]);
  assert.deepEqual(layout.order, ["Done", "Removed", "Todo", "Done"]);
  assert.deepEqual(resolveColumnOrder(["Todo", "Done", "Todo"]), ["Todo", "Done"]);
});

test("corrupt persisted layouts sanitize without accepting arrays or unsafe values", () => {
  for (const value of [null, "bad", [], 42]) assert.deepEqual(sanitizeLayouts(value), {});
  const result = sanitizeLayouts({ first: { order: ["Todo", null, 42, "Done", "Todo", "", "x".repeat(2001)], collapsed: ["Done", "Done", {}] }, invalid: null, array: [], partial: { order: "bad" } });
  assert.deepEqual(result, { first: { order: ["Todo", "Done"], collapsed: ["Done"] }, partial: { order: [], collapsed: [] } });
  const proto = sanitizeLayouts(JSON.parse('{"__proto__":{"order":["Todo"],"collapsed":[]}}'));
  assert.equal(Object.getPrototypeOf(proto), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(proto, "__proto__")?.value.order, ["Todo"]);
});

test("persisted map and column arrays enforce bounds", () => {
  const result = sanitizeLayouts(Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`project-${i}`, { order: Array.from({ length: 250 }, (_, n) => `status-${n}`), collapsed: Array.from({ length: 250 }, (_, n) => `status-${n}`) }])));
  assert.equal(Object.keys(result).length, 100);
  assert.equal(result["project-0"].order.length, 200);
  assert.equal(result["project-0"].collapsed.length, 200);
  assert.deepEqual(sanitizeLayouts({ ["x".repeat(2001)]: { order: [], collapsed: [] } }), {});
});

test("header moves support before and after in either direction without mutation", () => {
  const source = ["Todo", "Doing", "Review", "Done"];
  assert.deepEqual(moveColumn(source, "Todo", "Review", "after"), ["Doing", "Review", "Todo", "Done"]);
  assert.deepEqual(moveColumn(source, "Done", "Doing", "before"), ["Todo", "Done", "Doing", "Review"]);
  assert.deepEqual(moveColumn(source, "Todo", "Review", "before"), ["Doing", "Todo", "Review", "Done"]);
  assert.deepEqual(moveColumn(source, "Done", "Doing", "after"), ["Todo", "Doing", "Done", "Review"]);
  assert.deepEqual(source, ["Todo", "Doing", "Review", "Done"]);
});

test("same or missing headers and already adjacent moves leave order unchanged", () => {
  const source = ["Todo", "Done"];
  for (const [from, to] of [["Todo", "Todo"], ["Missing", "Done"], ["Todo", "Missing"]]) assert.deepEqual(moveColumn(source, from, to, "before"), source);
  assert.deepEqual(moveColumn(source, "Todo", "Done", "before"), source);
  assert.deepEqual(moveColumn(source, "Done", "Todo", "after"), source);
});

test("collapse changes preserve order; moving a collapsed column preserves collapsed state", () => {
  const layout = { order: ["Todo", "Doing", "Done"], collapsed: ["Doing"] };
  const collapsed = toggleCollapsed(layout, "Done");
  assert.deepEqual(collapsed.collapsed, ["Doing", "Done"]);
  assert.deepEqual(collapsed.order, layout.order); assert.notEqual(collapsed.order, layout.order);
  const moved = { ...collapsed, order: moveColumn(collapsed.order, "Doing", "Done", "after") };
  assert.deepEqual(moved.order, ["Todo", "Done", "Doing"]); assert.deepEqual(moved.collapsed, ["Doing", "Done"]);
  assert.deepEqual(toggleCollapsed(moved, "Doing").collapsed, ["Done"]);
  assert.deepEqual(layout, { order: ["Todo", "Doing", "Done"], collapsed: ["Doing"] });
});

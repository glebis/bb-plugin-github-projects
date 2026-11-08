import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankRoute,
  decodeViewRoute,
  initialViewRoute,
  scrollPosition,
  stringMap,
  viewMap,
  visibility,
} from "../src/ui/view-state.js";
const saved = {
  ...blankRoute,
  page: "acme:7",
  view: "board" as const,
  q: "release",
  assignee: "me",
  status: "Todo",
  sort: "date",
  task: "task-id",
  project: "acme:7",
  dateFields: { "acme:7": "Due" },
};
test("reopen restores all navigation and filters from saved state", () => {
  assert.deepEqual(initialViewRoute(undefined, saved), saved);
  assert.deepEqual(initialViewRoute("", saved), saved);
  assert.deepEqual(initialViewRoute("/", saved), saved);
});
test("explicit encoded deep link wins, including deliberate All route", () => {
  const deepLink = {
    ...blankRoute,
    page: "mine",
    task: "specific",
    project: "beta:2",
  };
  assert.deepEqual(
    initialViewRoute(encodeURIComponent(JSON.stringify(deepLink)), saved),
    deepLink,
  );
  assert.deepEqual(
    initialViewRoute(encodeURIComponent(JSON.stringify(blankRoute)), saved),
    blankRoute,
  );
});
test("malformed persisted values never become explicit All routes", () => {
  for (const value of [null, [], "bad", 5, {}, { q: "only" }, { page: "" }]) {
    assert.equal(decodeViewRoute(JSON.stringify(value)), null);
    assert.deepEqual(initialViewRoute("bad", value), blankRoute);
  }
  assert.equal(decodeViewRoute("%malformed"), null);
});
test("stored preferences sanitize malformed collection values", () => {
  assert.deepEqual(stringMap(["bad"]), {});
  assert.deepEqual(
    viewMap({ first: "board", second: "list", third: "invalid", nested: {} }),
    { first: "board", second: "list" },
  );
  assert.deepEqual(visibility({ assignee: false, date: "false" }), {
    assignee: false,
    date: true,
  });
  assert.deepEqual(visibility(null), { assignee: true, date: true });
});
test("scroll positions reject nonfinite and negative values and retain board offset", () => {
  assert.deepEqual(
    scrollPosition({ main: 430, board: 840, outer: -3, sidebar: Infinity }),
    { main: 430, board: 840, outer: 0, sidebar: 0 },
  );
  assert.deepEqual(scrollPosition(null), {
    main: 0,
    board: 0,
    outer: 0,
    sidebar: 0,
  });
});

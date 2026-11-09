import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { formatDate, formatNumber, languageKey, localizeMessage, messages, normalizeLocale, plural, readLocale, translate, writeLocale } from "../src/i18n/index.js";

test("English is the default; language persists independently of workspace state and tolerates unavailable storage", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(readLocale(storage), "en");
  writeLocale(storage, "ru");
  assert.equal(values.get(languageKey), "ru");
  assert.equal(readLocale(storage), "ru");
  assert.equal(normalizeLocale("de"), "en");
  assert.equal(readLocale({ getItem() { throw new Error("blocked"); } }), "en");
  assert.doesNotThrow(() => writeLocale({ setItem() { throw new Error("blocked"); } }, "en"));
});

test("translations interpolate whole sentences without changing names or markup-like content", () => {
  assert.equal(translate("en", "Настройки"), "Settings");
  assert.equal(translate("ru", "Настройки"), "Настройки");
  const name = "<script>Название ${value}</script>";
  assert.equal(translate("en", "Переместить колонку {value0}", { value0: name }), `Move column ${name}`);
  assert.equal(translate("en", "unknown future key"), "unknown future key");
});

test("all English messages are complete and preserve the source interpolation variables", () => {
  const placeholders = (s: string) => [...s.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
  for (const [source, english] of Object.entries(messages)) {
    assert.ok(english.trim(), source);
    assert.doesNotMatch(english, /[А-Яа-яЁё]/, source);
    assert.deepEqual(placeholders(english), placeholders(source), source);
  }
});

test("interface translation calls have catalog entries and visible Russian prose is not hardcoded", () => {
  for (const path of ["../app.tsx", "../src/ui/comments.tsx", "../src/ui/project-field-editor.tsx", "../src/ui/assignee-select.tsx"]) {
    const text = readFileSync(new URL(path, import.meta.url), "utf8");
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function inspect(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        assert.ok(Object.hasOwn(messages, node.arguments[0].text), `Missing translation in ${path}: ${node.arguments[0].text}`);
      }
      if (ts.isJsxText(node) && node.text.trim() !== "Русский") assert.doesNotMatch(node.text, /[А-Яа-яЁё]/, `Untranslated JSX in ${path}`);
      if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) assert.doesNotMatch(node.initializer.text, /[А-Яа-яЁё]/, `Untranslated attribute in ${path}`);
      ts.forEachChild(node, inspect);
    }
    inspect(file);
  }
});

test("localized dates use day-first conventions and 24-hour time, including timezone-free GitHub due dates", () => {
  const date = "2026-11-09T17:04:00Z";
  const options: Intl.DateTimeFormatOptions = { timeZone: "UTC", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  assert.match(formatDate("en", date, options), /9 November 2026.*17:04/);
  assert.match(formatDate("ru", date, options), /9 ноября 2026.*17:04/);
  assert.equal(formatDate("en", "2026-11-09", { day: "numeric", month: "short" }), "9 Nov");
  assert.equal(formatDate("en", "bad-date"), "bad-date");
  assert.equal(formatNumber("en", 1234), "1,234");
});

test("task counts choose English and Russian plural categories", () => {
  const forms = { one: "задача", few: "задачи", many: "задач", other: "задач" };
  assert.equal(plural("ru", 1, forms), "задача");
  assert.equal(plural("ru", 2, forms), "задачи");
  assert.equal(plural("ru", 5, forms), "задач");
  assert.equal(plural("ru", 21, forms), "задача");
  assert.equal(plural("en", 1, forms), "task");
  assert.equal(plural("en", 2, forms), "tasks");
});

test("server diagnostics translate nested failures and preserve raw details and unknown errors", () => {
  assert.equal(localizeMessage("en", "Нет прав изменять статусы этого проекта."), "You cannot change statuses in this project.");
  assert.equal(localizeMessage("ru", "Field values incomplete"), "Значения полей загружены не полностью");
  assert.equal(localizeMessage("en", "GitHub отклонил загрузку файла (HTTP 403)."), "GitHub rejected the file upload (HTTP 403).");
  const warning = "Изменение выполнено в GitHub, но обновить список не удалось: Сначала обновите проект.. Не повторяйте действие, обновите список.";
  assert.equal(localizeMessage("en", warning), "The change was saved in GitHub, but the list could not be refreshed: Refresh the project first.. Refresh the list; do not repeat the action.");
  const url = "https://example.com/Настройки";
  assert.equal(localizeMessage("en", `Некорректная ссылка проекта: ${url}`), `Invalid project URL: ${url}`);
  assert.equal(localizeMessage("en", "Remote error: user supplied Настройки"), "Remote error: user supplied Настройки");
  assert.equal(localizeMessage("ru", "Changes saved in GitHub"), "Изменения сохранены в GitHub");
});

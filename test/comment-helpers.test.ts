import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mediaError,
  mentionAt,
  replaceRange,
  replyText,
} from "../src/ui/comment-helpers";
test("mentions trigger at whitespace/start, not email addresses", () => {
  assert.deepEqual(mentionAt("Привет @ann", 11), {
    query: "ann",
    start: 7,
    end: 11,
  });
  assert.equal(mentionAt("mail@example.com", 16), null);
  assert.deepEqual(mentionAt("@", 1), { query: "", start: 0, end: 1 });
  assert.equal(mentionAt("hello @name text", 16), null);
});
test("formatting replacement preserves text before/after cursor selection", () => {
  assert.deepEqual(replaceRange("до слово после", 3, 8, "**слово**"), {
    body: "до **слово** после",
    cursor: 12,
  });
});
test("media permits exact limit and rejects oversized or disguised files", () => {
  assert.equal(
    mediaError({ name: "photo.PNG", type: "image/png", size: 5 * 1024 * 1024 }),
    null,
  );
  assert.match(
    mediaError({
      name: "big.mp4",
      type: "video/mp4",
      size: 5 * 1024 * 1024 + 1,
    }) || "",
    /5 МиБ/,
  );
  assert.ok(
    mediaError({ name: "report.pdf", type: "application/pdf", size: 20 }),
  );
  assert.ok(mediaError({ name: "image.png", type: "text/html", size: 20 }));
  assert.ok(mediaError({ name: "empty.png", type: "image/png", size: 0 }));
});
test("flat reply contains short quoted context, original link and author", () => {
  const result = replyText({
    body: "Текст ".repeat(80),
    url: "https://github.com/a/b/issues/1#issuecomment-2",
    author: "anna",
  });
  assert.ok(result.startsWith("> Текст"));
  assert.ok(
    result.includes(
      "[Original comment](https://github.com/a/b/issues/1#issuecomment-2) · @anna",
    ),
  );
  assert.ok(result.length < 330);
  assert.equal(
    replyText({
      body: "hello",
      url: "https://github.com/a/b",
      author: null,
    }).includes("@null"),
    false,
  );
});

test("reply link label follows locale without translating quoted content or author", () => {
  const comment = {
    body: "User text remains exactly as written",
    url: "https://github.com/a/b#issuecomment-1",
    author: "anna",
  };
  const russian = replyText(comment, "Исходный комментарий");
  assert.match(russian, /\[Исходный комментарий\]/);
  assert.match(russian, /> User text remains exactly as written/);
  assert.match(russian, /@anna/);
  assert.match(replyText(comment), /\[Original comment\]/);
});

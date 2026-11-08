import { test } from "node:test";
import assert from "node:assert/strict";
import {
  uploadCommentAttachment,
  validateAttachment,
  MAX_ATTACHMENT_BYTES,
  type AttachmentOptions,
} from "../src/github/attachments.js";
const repo = {
  databaseId: 1234,
  viewerPermission: "WRITE",
  isArchived: false,
  isDisabled: false,
};
const options = (
  extra: Partial<AttachmentOptions> = {},
): AttachmentOptions => ({
  graphql: async () => ({ repository: repo }),
  getToken: async () => "fake-test-credential",
  ...extra,
});
test("upload mirrors official CLI raw-byte protocol and safely renders image markdown", async () => {
  let calls = 0;
  const bytes = Buffer.from("not-real-media-for-mock");
  const result = await uploadCommentAttachment(
    "acme/repo",
    "shot[one]#v1.png",
    "image/png",
    bytes,
    options({
      fetch: async (input, init) => {
        calls++;
        const url = new URL(String(input));
        assert.equal(url.origin, "https://uploads.github.com");
        assert.equal(url.pathname, "/user-attachments/assets");
        assert.equal(url.searchParams.get("repository_id"), "1234");
        assert.equal(url.searchParams.get("content_type"), "image/png");
        assert.equal(url.searchParams.get("name"), "shot[one]#v1.png");
        assert.equal(init?.method, "POST");
        assert.equal(init?.redirect, "error");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("Content-Type"), "application/octet-stream");
        assert.equal(
          headers.get("Authorization"),
          "token fake-test-credential",
        );
        assert.equal(headers.get("Content-Length"), String(bytes.length));
        assert.deepEqual(Buffer.from(init?.body as Uint8Array), bytes);
        return Response.json(
          { url: "https://github.com/user-attachments/assets/asset-id" },
          { status: 201 },
        );
      },
    }),
  );
  assert.equal(calls, 1);
  assert.equal(
    result.markdown,
    "![shot\\[one\\]#v1.png](https://github.com/user-attachments/assets/asset-id)",
  );
});
test("only documented media types, matching MIME and nonempty files up to 5MiB pass validation", () => {
  for (const name of [
    "doc.pdf",
    "archive.zip",
    "../image.png",
    "path\\image.png",
    "bad\n.png",
  ])
    assert.throws(() => validateAttachment(name, "", Buffer.from("x")));
  assert.throws(() =>
    validateAttachment("image.png", "text/html", Buffer.from("x")),
  );
  assert.throws(() => validateAttachment("image.png", "", Buffer.alloc(0)));
  assert.throws(() =>
    validateAttachment("image.png", "", Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)),
  );
  assert.equal(
    validateAttachment("image.PNG", "", Buffer.alloc(MAX_ATTACHMENT_BYTES))
      .contentType,
    "image/png",
  );
});
test("read-only repository fails before token lookup or upload", async () => {
  let tokenRead = false;
  let upload = false;
  await assert.rejects(
    uploadCommentAttachment(
      "acme/repo",
      "image.png",
      "",
      Buffer.from("x"),
      options({
        graphql: async () => ({
          repository: { ...repo, viewerPermission: "READ" },
        }),
        getToken: async () => {
          tokenRead = true;
          return "unused";
        },
        fetch: async () => {
          upload = true;
          return Response.json({});
        },
      }),
    ),
  );
  assert.equal(tokenRead, false);
  assert.equal(upload, false);
});
test("failed uploads never retry and response diagnostics cannot echo credentials", async () => {
  let calls = 0;
  await assert.rejects(
    uploadCommentAttachment(
      "acme/repo",
      "image.png",
      "",
      Buffer.from("x"),
      options({
        fetch: async () => {
          calls++;
          return new Response("fake-test-credential", { status: 404 });
        },
      }),
    ),
    (error) => {
      assert.doesNotMatch(String(error), /fake-test-credential/);
      return true;
    },
  );
  assert.equal(calls, 1);
});
test("unsafe returned links rejected after upload; video renders as a bare GitHub URL", async () => {
  await assert.rejects(
    uploadCommentAttachment(
      "acme/repo",
      "image.png",
      "",
      Buffer.from("x"),
      options({
        fetch: async () => Response.json({ url: "https://evil.test/asset" }),
      }),
    ),
    /Не повторяйте/,
  );
  const result = await uploadCommentAttachment(
    "acme/repo",
    "clip.mp4",
    "video/mp4",
    Buffer.from("x"),
    options({
      fetch: async () =>
        Response.json({
          url: "https://github.com/user-attachments/assets/video-id",
        }),
    }),
  );
  assert.equal(result.markdown, result.url);
});

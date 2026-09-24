import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  createChatComposerAttachment,
  createClipboardTextAttachmentFilenameForDate,
  createClipboardTextPathComposerAttachment,
  revokeChatComposerAttachment,
  serializeChatComposerAttachment,
  shouldCreateClipboardTextAttachment,
  shouldPreferSpreadsheetClipboardText,
} from "../src/lib/chatAttachments.js";
import { uploadComposerAttachment } from "../src/v4/composer/attachmentUpload.js";

// 执行生产回调而非复制实现；隔离 React 生命周期和平台端口，覆盖 preventDefault 后的异步失败。
async function pasteHarness(createTempTextAttachment?: (args: unknown) => Promise<unknown>) {
  const source = await readFile(
    new URL("../src/v4/composer/useComposerAttachments.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("  const handlePaste = useCallback(");
  const end = source.indexOf("  const clearDragFeedbackTimer", start);
  const js = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });
  const files: File[] = [];
  const prepared: unknown[] = [];
  const errors: unknown[] = [];
  const deps = {
    useCallback: (callback: unknown) => callback,
    disabled: false,
    platform: { createTempTextAttachment },
    logger: { debug() {}, warn() {} },
    intl: { formatMessage: () => "read failed" },
    addAttachmentFiles: (items: File[]) => files.push(...items),
    addPreparedAttachments: (items: unknown[]) => prepared.push(...items),
    setAttachmentError: (error: unknown) => errors.push(error),
    shouldPreferSpreadsheetClipboardText,
    shouldCreateClipboardTextAttachment,
    createClipboardTextAttachmentFilenameForDate,
    createClipboardTextPathComposerAttachment,
  };
  const handlePaste = new Function(...Object.keys(deps), `${js}\nreturn handlePaste;`)(
    ...Object.values(deps),
  );
  return {
    files,
    prepared,
    errors,
    async paste(text: string) {
      let prevented = false;
      handlePaste({
        clipboardData: {
          files: [],
          getData: (type: string) => (type === "text/plain" ? text : ""),
        },
        preventDefault() {
          prevented = true;
        },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      return prevented;
    },
  };
}

for (const native of ["reject", "absent"] as const) {
  for (const length of [15360, 20000]) {
    test(`long Web paste (${native}, ${length}) uploads a sendable txt ref with intact UTF-8`, async () => {
      const harness = await pasteHarness(
        native === "reject"
          ? async () => {
              throw new Error("desktop only");
            }
          : undefined,
      );
      const text = "中".repeat(length - 2) + "\n尾";
      assert.equal(await harness.paste(text), true);
      assert.equal(harness.files.length, 1);
      assert.deepEqual(harness.errors, []);
      const file = harness.files[0]!;
      assert.match(file.name, /\.txt$/);
      assert.equal(file.type, "text/plain");
      assert.equal(await file.text(), text);
      const attachment = createChatComposerAttachment(file);
      try {
        const serialized = await serializeChatComposerAttachment(attachment);
        let uploads = 0;
        const ref = await uploadComposerAttachment(
          async (params) => {
            uploads++;
            assert.equal(params.sessionId, "test-session");
            assert.equal(Buffer.from(params.dataBase64, "base64").toString("utf8"), text);
            return { ref: "artifact:test-text" };
          },
          "test-session",
          serialized,
        );
        assert.equal(uploads, 1);
        assert.equal(ref?.ref, "artifact:test-text");
        assert.equal(ref?.bytes, Buffer.byteLength(text));
      } finally {
        revokeChatComposerAttachment(attachment);
      }
    });
  }
}

test("short paste stays in editor; native success preserves path", async () => {
  let calls = 0;
  const harness = await pasteHarness(async () => {
    calls++;
    return {
      localPath: "/tmp/paste.txt",
      filename: "paste.txt",
      mimeType: "text/plain",
      sizeBytes: 15360,
    };
  });
  assert.equal(await harness.paste("x".repeat(15359)), false);
  assert.equal(calls, 0);
  assert.equal(await harness.paste("x".repeat(15360)), true);
  assert.equal(calls, 1);
  assert.equal(harness.files.length, 0);
  assert.equal(harness.prepared.length, 1);
  assert.deepEqual(harness.errors, []);
});

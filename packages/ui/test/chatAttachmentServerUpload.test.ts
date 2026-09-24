import assert from "node:assert/strict";
import test from "node:test";
import {
  SERVER_UPLOAD_ATTACHMENT_MAX_BYTES,
  createChatComposerAttachment,
  serializeChatComposerAttachment,
  type ChatComposerServerUploadOptions,
} from "../src/lib/chatAttachments.js";
import { OversizedServerUploadAttachmentError } from "../src/lib/chatAttachmentErrors.js";

const SERVER_PATH = "/var/tmp/zcode-uploads/uuid-1/report.zip";

/** 记录请求并以受控响应驱动 onload/onprogress 的 XMLHttpRequest 替身。 */
class FakeXhr {
  static instances: FakeXhr[] = [];
  static nextStatus = 200;
  static nextResponse: unknown = { path: SERVER_PATH };

  method = "";
  url = "";
  status = 0;
  response: unknown = null;
  responseType = "";
  upload = {
    onprogress: null as
      | ((event: { lengthComputable: boolean; loaded: number; total: number }) => void)
      | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  sentBody: unknown = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  send(body: unknown) {
    this.sentBody = body;
    this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    this.status = FakeXhr.nextStatus;
    this.response = FakeXhr.nextResponse;
    this.onload?.();
  }
}

function withFakeXhr(run: () => Promise<void>) {
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  return run().finally(() => {
    globalThis.XMLHttpRequest = original;
    FakeXhr.instances = [];
    FakeXhr.nextStatus = 200;
    FakeXhr.nextResponse = { path: SERVER_PATH };
  });
}

test("pathless non-text file uploads to /api/upload and returns server path", async () => {
  await withFakeXhr(async () => {
    const file = new File(["zip-bytes"], "report.zip", { type: "application/zip" });
    const attachment = createChatComposerAttachment(file);
    const progress: { uploadedBytes: number; totalBytes: number }[] = [];
    const options: ChatComposerServerUploadOptions = {
      onProgress: (p) => progress.push(p),
    };

    const result = await serializeChatComposerAttachment(attachment, { serverUpload: options });

    assert.equal(result.kind, "file");
    assert.equal(result.localPath, SERVER_PATH);
    assert.equal(result.filename, "report.zip");
    assert.equal(result.sizeBytes, 9);

    const [xhr] = FakeXhr.instances;
    assert.equal(xhr.method, "POST");
    assert.equal(xhr.url, "/api/upload?filename=report.zip");
    assert.ok(xhr.sentBody instanceof File);
    assert.deepEqual(progress, [
      { uploadedBytes: 50, totalBytes: 100 },
      { uploadedBytes: 100, totalBytes: 100 },
    ]);
  });
});

test("text-like files keep the textContent branch and never upload", async () => {
  await withFakeXhr(async () => {
    const file = new File(["const a = 1"], "app.ts", { type: "" });
    const attachment = createChatComposerAttachment(file);

    const result = await serializeChatComposerAttachment(attachment, {
      serverUpload: {},
    });

    assert.equal(FakeXhr.instances.length, 0);
    assert.equal(result.kind, "file");
    assert.equal("textContent" in result && result.textContent, "const a = 1");
    assert.equal(result.localPath, undefined);
  });
});

test("desktop (no serverUpload option) keeps the content-less branch", async () => {
  await withFakeXhr(async () => {
    const file = new File(["zip-bytes"], "report.zip", { type: "application/zip" });
    const attachment = createChatComposerAttachment(file);

    const result = await serializeChatComposerAttachment(attachment);

    assert.equal(FakeXhr.instances.length, 0);
    assert.equal(result.kind, "file");
    assert.equal(result.localPath, undefined);
    assert.equal("textContent" in result, false);
  });
});

test("oversized pathless files throw the structured error before uploading", async () => {
  await withFakeXhr(async () => {
    const file = new File([Buffer.alloc(4)], "big.zip", { type: "application/zip" });
    // 直接把 sizeBytes 报成超限，避免测试里真的构造 100MiB
    const attachment = {
      ...createChatComposerAttachment(file),
      sizeBytes: SERVER_UPLOAD_ATTACHMENT_MAX_BYTES + 1,
    };

    await assert.rejects(
      serializeChatComposerAttachment(attachment, { serverUpload: {} }),
      OversizedServerUploadAttachmentError,
    );
    assert.equal(FakeXhr.instances.length, 0);
  });
});

test("server 413 maps to the structured oversized error", async () => {
  await withFakeXhr(async () => {
    FakeXhr.nextStatus = 413;
    FakeXhr.nextResponse = { error: "Payload too large" };
    const file = new File(["zip-bytes"], "report.zip", { type: "application/zip" });
    const attachment = createChatComposerAttachment(file);

    await assert.rejects(
      serializeChatComposerAttachment(attachment, { serverUpload: {} }),
      (error: unknown) =>
        error instanceof OversizedServerUploadAttachmentError &&
        error.filename === "report.zip" &&
        error.maxSizeBytes === SERVER_UPLOAD_ATTACHMENT_MAX_BYTES,
    );
  });
});

test("aborted signal cancels the upload", async () => {
  await withFakeXhr(async () => {
    const controller = new AbortController();
    controller.abort();
    const file = new File(["zip-bytes"], "report.zip", { type: "application/zip" });
    const attachment = createChatComposerAttachment(file);

    await assert.rejects(
      serializeChatComposerAttachment(attachment, { serverUpload: { signal: controller.signal } }),
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
  });
});

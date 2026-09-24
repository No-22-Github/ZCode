import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import test from "node:test";
import { ServiceCollection } from "@zcode/services";
import { createHttpServer, createUploadSizeLimiter, SERVER_UPLOAD_MAX_BYTES } from "../src/http.js";

async function startTestServer() {
  const uploadRoot = await mkdtemp(join(tmpdir(), "zcode-upload-test-"));
  process.env.ZCODE_UPLOAD_DIR = uploadRoot;
  const server = createHttpServer(new ServiceCollection(), 0, { spaFallback: false });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    uploadRoot,
    port,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      delete process.env.ZCODE_UPLOAD_DIR;
    },
  };
}

test("upload route stores body under a 0700 dir and returns absolute path", async () => {
  const context = await startTestServer();
  try {
    const body = Buffer.from("hello zip content");
    const response = await fetch(
      `http://127.0.0.1:${context.port}/api/upload?filename=${encodeURIComponent("report.zip")}`,
      { method: "POST", body },
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { path?: string };
    assert.ok(payload.path?.endsWith("report.zip"));
    assert.ok(payload.path.startsWith(context.uploadRoot));
    assert.equal(await readFile(payload.path!, "utf8"), "hello zip content");

    // 目录 700、文件 600
    const fileStat = await stat(payload.path!);
    assert.equal(fileStat.mode & 0o777, 0o600);
    const dirStat = await stat(join(payload.path!, ".."));
    assert.equal(dirStat.mode & 0o777, 0o700);
  } finally {
    await context.close();
  }
});

test("upload route rejects hostile and empty filenames", async () => {
  const context = await startTestServer();
  try {
    for (const filename of ["", ".", "..", "..\0evil"]) {
      const response = await fetch(
        `http://127.0.0.1:${context.port}/api/upload?filename=${encodeURIComponent(filename)}`,
        { method: "POST", body: Buffer.from("x") },
      );
      assert.equal(response.status, 400, `filename: ${filename}`);
    }
    // 目录穿越被剥成 basename，最终仍落在上传目录内
    const response = await fetch(
      `http://127.0.0.1:${context.port}/api/upload?filename=${encodeURIComponent("../../etc/passwd")}`,
      { method: "POST", body: Buffer.from("x") },
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { path?: string };
    assert.ok(payload.path?.endsWith("passwd"));
    assert.ok(payload.path!.startsWith(context.uploadRoot));
  } finally {
    await context.close();
  }
});

test("upload route writes an empty file for an empty body", async () => {
  const context = await startTestServer();
  try {
    // undici 对无 body 的 POST 也会给出空流；按“原始字节流直接写”的语义落一个 0 字节文件
    const response = await fetch(`http://127.0.0.1:${context.port}/api/upload?filename=a.txt`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { path?: string };
    assert.deepEqual(await readFile(payload.path!), Buffer.alloc(0));
  } finally {
    await context.close();
  }
});

test("upload size limiter aborts once the byte cap is exceeded", async () => {
  const limiter = createUploadSizeLimiter(1024);
  const outcome = await new Promise<string>((resolve) => {
    limiter.on("error", (error: Error) => resolve(error.message));
    limiter.on("finish", () => resolve("finish"));
    limiter.end(Buffer.alloc(2048, 1));
  });
  assert.equal(outcome, "upload payload too large");
});

test("server upload cap is 100MiB", () => {
  assert.equal(SERVER_UPLOAD_MAX_BYTES, 100 * 1024 * 1024);
});

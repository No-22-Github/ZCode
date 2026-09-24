import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);

test("archive-only packages without a download origin; normal distribution stays compatible", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-packaging-test-"));
  const put = async (path, value) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), value);
  };
  try {
    await put("package.json", '{"type":"module","version":"1.2.3"}');
    await put(
      "scripts/load-endpoint-env.mjs",
      "export async function loadEndpointEnv() { return {}; }",
    );
    await put(
      "scripts/zcode-distribution/assets.mjs",
      "export async function stageTuiRuntime() {} export async function copyRuntimeNodeModules() {} export async function patchNodePtyPrebuilds() {}",
    );
    await cp(new URL("build-zcode.mjs", import.meta.url), join(root, "scripts/build-zcode.mjs"));
    await cp(
      new URL("zcode-distribution/installer.mjs", import.meta.url),
      join(root, "scripts/zcode-distribution/installer.mjs"),
    );
    await cp(
      new URL("zcode-distribution/deploy", import.meta.url),
      join(root, "scripts/zcode-distribution/deploy"),
      { recursive: true },
    );
    for (const path of [
      "packages/web/dist/index.html",
      "packages/server/dist/entry-http.js",
      "apps/zcode-cli/packages/cli/dist/zcode.cjs",
      "apps/zcode-cli/packages/cli/dist/provider/zcode-builtin.json",
      "apps/zcode-cli/packages/cli/dist/THIRD-PARTY-NOTICES.md",
      "scripts/zcode-distribution/runner.mjs",
    ])
      await put(path, "fixture");
    const build = (...args) =>
      exec(process.execPath, [join(root, "scripts/build-zcode.mjs"), "--skip-build", ...args], {
        cwd: root,
      });
    await assert.rejects(build(), /Configure ZCODE_DIST_BASE_URL/);
    await build("--archive-only", "--version", "1.2.3-no22.1.1", "--out-dir", "archive");
    const archive = join(root, "archive/releases/1.2.3-no22.1.1/zcode-1.2.3-no22.1.1.tar.gz");
    const { stdout: entries } = await exec("tar", ["-tzf", archive]);
    assert.match(entries, /zcode\/web\/index.html/);
    assert.match(entries, /zcode\/deploy\/zcode.service/);
    const checksum = await readFile(join(dirname(archive), "sha256.txt"), "utf8");
    assert.match(checksum, /^[a-f0-9]{64}  zcode-1.2.3-no22.1.1.tar.gz\n$/);
    await assert.rejects(readFile(join(root, "archive/install.sh")), { code: "ENOENT" });
    await assert.rejects(readFile(join(root, "archive/latest.json")), { code: "ENOENT" });
    await build("--base-url", "https://downloads.example.com/zcode/", "--out-dir", "normal");
    const index = JSON.parse(await readFile(join(root, "normal/latest.json"), "utf8"));
    assert.equal(index.version, "1.2.3");
    assert.equal(index.baseUrl, "https://downloads.example.com/zcode/");
    assert.match(await readFile(join(root, "normal/install.sh"), "utf8"), /downloads.example.com/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

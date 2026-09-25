import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const script = fileURLToPath(new URL("publish-latest-build.sh", import.meta.url));

for (const scenario of ["new", "existing", "upload-failure"]) {
  test(`rolling release: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-release-test-"));
    try {
      const version = "3.14.3-no22.42.2";
      const dir = join(root, "dist/zcode/releases", version);
      await mkdir(dir, { recursive: true });
      await mkdir(join(root, "bin"));
      await writeFile(join(dir, `zcode-${version}.tar.gz`), "verified archive");
      await writeFile(
        join(root, "bin/gh"),
        `#!/bin/bash
set -eu
echo "$*" >> "$TEST_ROOT/calls"
case "$2" in
  view) [ "$SCENARIO" != new ] ;;
  upload)
    [ "$SCENARIO" != upload-failure ] || exit 1
    for asset in zcode-linux-x64.tar.gz sha256.txt build.txt; do
      for arg in "$@"; do
        if [ "$arg" = "$asset" ]; then cp "$asset" "$TEST_ROOT/$asset"; fi
      done
    done ;;
  edit) cp notes.md "$TEST_ROOT/notes.md" ;;
esac
`,
        { mode: 0o755 },
      );
      const run = exec("bash", [script], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${join(root, "bin")}:${process.env.PATH}`,
          TEST_ROOT: root,
          SCENARIO: scenario,
          RELEASE_VERSION: version,
          BUILD_TIME: "2026-09-25T08:30:00.000Z",
          GITHUB_REPOSITORY: "example/zcode",
          GITHUB_SHA: "abcdef1234",
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_RUN_ID: "123",
          RUNNER_TEMP: root,
        },
      });
      if (scenario === "upload-failure") await assert.rejects(run);
      else await run;
      const calls = await readFile(join(root, "calls"), "utf8");
      assert.equal(calls.includes("release create"), scenario === "new");
      assert.match(
        calls,
        /release upload latest-build zcode-linux-x64.tar.gz sha256.txt .*--clobber/,
      );
      if (scenario === "upload-failure") {
        assert.doesNotMatch(calls, /release edit|release upload latest-build build.txt/);
        return;
      }
      assert.equal(
        await readFile(join(root, "build.txt"), "utf8"),
        `${version}\nBuild time (UTC): 2026-09-25T08:30:00.000Z\n`,
      );
      const hash = createHash("sha256").update("verified archive").digest("hex");
      assert.equal(
        await readFile(join(root, "sha256.txt"), "utf8"),
        `${hash}  zcode-linux-x64.tar.gz\n`,
      );
      assert.match(await readFile(join(root, "notes.md"), "utf8"), /abcdef1234/);
      assert.match(
        calls.trim().split("\n").at(-1),
        /release upload latest-build build.txt .*--clobber/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

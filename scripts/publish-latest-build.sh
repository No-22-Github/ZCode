#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_VERSION:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_SHA:?}"
: "${GITHUB_SERVER_URL:?}" "${GITHUB_RUN_ID:?}" "${RUNNER_TEMP:?}"
: "${BUILD_TIME:?}"

release_dir="dist/zcode/releases/$RELEASE_VERSION"
staging=$(mktemp -d "$RUNNER_TEMP/latest-build.XXXXXX")
trap 'rm -rf "$staging"' EXIT
cp "$release_dir/zcode-$RELEASE_VERSION.tar.gz" "$staging/zcode-linux-x64.tar.gz"
cd "$staging"
shasum -a 256 zcode-linux-x64.tar.gz > sha256.txt
printf '%s\nBuild time (UTC): %s\n' "$RELEASE_VERSION" "$BUILD_TIME" > build.txt
cat > notes.md <<EOF
Rolling Linux x64 build: $RELEASE_VERSION

Source commit: $GITHUB_SHA
Build run: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID

Download zcode-linux-x64.tar.gz and sha256.txt, then verify with sha256sum -c sha256.txt.
Read build.txt for the actual build version. The fixed tag is a download anchor.
Requires Node 24.x on a glibc Linux x64 host.
EOF

# 固定 asset 名称才能覆盖旧构建；构建号最后上传，避免提前宣告发布完成。
if ! gh release view latest-build --repo "$GITHUB_REPOSITORY" > /dev/null; then
  gh release create latest-build --repo "$GITHUB_REPOSITORY" \
    --target "$GITHUB_SHA" --title "Latest Linux x64 build" \
    --prerelease --latest=false --notes-file notes.md
fi
gh release upload latest-build zcode-linux-x64.tar.gz sha256.txt \
  --repo "$GITHUB_REPOSITORY" --clobber
gh release edit latest-build --repo "$GITHUB_REPOSITORY" \
  --title "Latest Linux x64 build ($RELEASE_VERSION)" --notes-file notes.md
gh release upload latest-build build.txt --repo "$GITHUB_REPOSITORY" --clobber

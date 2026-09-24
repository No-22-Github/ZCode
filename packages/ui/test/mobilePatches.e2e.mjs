// Run against pnpm dev:web: node packages/ui/test/mobilePatches.e2e.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await page.goto(process.env.ZCODE_TEST_URL ?? "http://localhost:5173");
  const toggle = page.getByTestId("web-sidebar-toggle");
  await toggle.waitFor();
  assert.equal(await page.evaluate(() => navigator.maxTouchPoints > 0), true);
  const width = () =>
    page
      .locator("[data-workspace-sidebar-panel]")
      .evaluate((el) => el.getBoundingClientRect().width);
  // 等待初始布局，点击测试覆盖真正的 React shell 和动画，不修改 store。
  await page.waitForTimeout(600);
  if ((await width()) > 0) {
    await toggle.tap();
    await page.waitForTimeout(600);
  }
  assert.equal(await width(), 0);
  assert.equal(await toggle.locator("svg").evaluate((el) => getComputedStyle(el).opacity), "1");
  await toggle.tap();
  await page.waitForTimeout(1200);
  assert.ok((await width()) > 0, "manual expansion stays open past resize debounce");
  await toggle.tap();
  await page.waitForTimeout(600);
  assert.equal(await width(), 0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(600);
  await toggle.click();
  await page.waitForTimeout(600);
  assert.ok((await width()) > 0);
  console.log("PASS: touch icon visible, mobile open stays open, close and wide Web toggle");
} finally {
  await browser.close();
}

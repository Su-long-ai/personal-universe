import { test, expect } from "./support/test";
import { observeRuntime, waitForYeis } from "./support/runtime";

const basePath = (process.env.PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const path = (suffix: string) => basePath + suffix;
const projectId = "personal-universe";
const project = "/portfolio/" + projectId + "/";
const chineseProject = "/zh" + project;
const repo = "https://github.com/Su-long-ai/personal-universe";

test("regular 3D home keeps Search and links to the shareable project and back", async ({ page }, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(path("/?lang=en&freeze=1"));
  await waitForYeis(page);
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.locator("#portfolio-home-fallback")).toBeHidden();
  await page.getByRole("button", { name: /SEARCH \/ PLACES/i }).click();
  await expect(page.getByRole("dialog", { name: "Universe navigator" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Portfolio", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Portfolio" })).toBeVisible();
  await page.getByRole("link", { name: "Read project" }).click();
  await expect(page).toHaveURL(new RegExp(path(project) + "$"));
  await expect(page.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute("href", repo);

  await page.getByRole("link", { name: "Find this work in 3D" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-active-destination",
    "personal:" + projectId,
  );
  await expect(page.locator("canvas")).toHaveCount(1);
  await runtime.assertClean(testInfo);
});

test("a WebGL initialization failure leaves a browsable native portfolio", async ({ page }) => {
  const initErrors: string[] = [];
  page.on("pageerror", (error) => initErrors.push(error.message));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      contextId: string,
      options?: unknown,
    ) {
      if (/^(?:experimental-)?webgl2?$/.test(contextId)) return null;
      return Reflect.apply(original, this, [contextId, options]);
    };
  });
  await page.goto(path("/"));
  await expect.poll(() => initErrors.some((message) => message.includes("Error creating WebGL context"))).toBe(true);
  await expect(page.getByRole("heading", { name: "Explore the work without 3D." })).toBeVisible();
  await expect(page.getByRole("button", { name: /SEARCH \/ PLACES/i })).toHaveCount(0);

  await page.getByRole("link", { name: "Browse the portfolio" }).click();
  await page.getByRole("link", { name: "Read project" }).click();
  await expect(page.getByRole("heading", { name: "Personal Universe", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "One authored signal, one address" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute("href", repo);
  await expect(page.locator("astro-island")).toHaveCount(0);
});

test.describe("mobile without JavaScript", () => {
  test.use({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });

  test("home fallback opens Chinese project, references and same-project English link", async ({ page }) => {
    await page.goto(path("/"));
    await expect(page.getByRole("heading", { name: "Explore the work without 3D." })).toBeVisible();
    await expect(page.getByRole("button", { name: /SEARCH \/ PLACES/i })).toHaveCount(0);
    await page.getByRole("link", { name: "查看作品（中文）" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByRole("heading", { level: 1, name: "作品集" })).toBeVisible();
    await page.getByRole("link", { name: "查看详情" }).click();
    await expect(page).toHaveURL(new RegExp(path(chineseProject) + "$"));
    await expect(page.getByRole("heading", { level: 1, name: "个人宇宙" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "给作品一个稳定地址" })).toBeVisible();
    await expect(page.getByRole("link", { name: "GitHub 源码" })).toHaveAttribute("href", repo);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      "href",
      new RegExp(path(project) + "$"),
    );
    await page.getByRole("link", { name: "English", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(path(project) + "$"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("direct localized project URL renders on reload without a browser app", async ({ page }) => {
    const response = await page.goto(path(chineseProject));
    expect(response?.ok()).toBe(true);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(path(chineseProject) + "$"),
    );
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "个人宇宙" })).toBeVisible();
    await expect(page.locator("script, astro-island, canvas")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "在 3D 星图中查看" })).toHaveAttribute(
      "href",
      path("/?lang=zh&destination=personal%3A" + projectId),
    );
  });
});

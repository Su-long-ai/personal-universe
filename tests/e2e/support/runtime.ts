import { expect, type Page, type TestInfo } from "@playwright/test";

type Problem = {
  kind:
    | "pageerror"
    | "unhandledrejection"
    | "webglcontextlost"
    | "webglcontextcreationerror"
    | "console"
    | "requestfailed"
    | "http";
  detail: string;
};

type RuntimeGuardOptions = {
  allowConsoleErrors?: RegExp[];
  allowFailedRequests?: RegExp[];
};

const CRITICAL_REQUESTS = [
  /\/_astro\/[^?#]+\.(?:js|mjs|css)(?:\?|$)/i,
  /\/vendor\/yeis\/data\/stars\.bin(?:\?|$)/i,
  /\/vendor\/yeis\/data\/star-names\.json(?:\?|$)/i,
];

function matchesAny(value: string, patterns: RegExp[] = []) {
  return patterns.some((pattern) => pattern.test(value));
}

function isCritical(url: string) {
  return CRITICAL_REQUESTS.some((pattern) => pattern.test(url));
}

export async function observeRuntime(
  page: Page,
  options: RuntimeGuardOptions = {},
) {
  const problems: Problem[] = [];

  await page.exposeFunction("__puRecordUnhandledRejection", (detail: string) => {
    problems.push({ kind: "unhandledrejection", detail });
  });
  await page.exposeFunction(
    "__puRecordWebglProblem",
    (
      kind: "webglcontextlost" | "webglcontextcreationerror",
      detail: string,
    ) => {
      problems.push({ kind, detail });
    },
  );
  await page.addInitScript(() => {
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      const detail =
        reason instanceof Error
          ? reason.stack || reason.message
          : typeof reason === "string"
            ? reason
            : JSON.stringify(reason);
      void (
        window as typeof window & {
          __puRecordUnhandledRejection: (value: string) => Promise<void>;
        }
      ).__puRecordUnhandledRejection(detail || "Unhandled promise rejection");
    });

    const recordWebgl = (event: Event) => {
      const kind = event.type as
        | "webglcontextlost"
        | "webglcontextcreationerror";
      const status =
        "statusMessage" in event
          ? String((event as WebGLContextEvent).statusMessage || "")
          : "";
      void (
        window as typeof window & {
          __puRecordWebglProblem: (
            value: "webglcontextlost" | "webglcontextcreationerror",
            detail: string,
          ) => Promise<void>;
        }
      ).__puRecordWebglProblem(
        kind,
        status ? `${kind}: ${status}` : kind,
      );
    };
    document.addEventListener("webglcontextlost", recordWebgl, true);
    document.addEventListener(
      "webglcontextcreationerror",
      recordWebgl,
      true,
    );
  });

  page.on("pageerror", (error) => {
    problems.push({ kind: "pageerror", detail: error.message });
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const detail = message.text();
    if (matchesAny(detail, options.allowConsoleErrors)) return;
    problems.push({ kind: "console", detail });
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!isCritical(url) || matchesAny(url, options.allowFailedRequests)) return;
    problems.push({
      kind: "requestfailed",
      detail: `${request.failure()?.errorText ?? "failed"} ${url}`,
    });
  });

  page.on("response", (response) => {
    const url = response.url();
    if (
      response.status() < 400 ||
      !isCritical(url) ||
      matchesAny(url, options.allowFailedRequests)
    ) {
      return;
    }
    problems.push({
      kind: "http",
      detail: `${response.status()} ${url}`,
    });
  });

  return {
    problems,
    async assertClean(testInfo: TestInfo) {
      if (problems.length > 0) {
        await testInfo.attach("runtime-problems.json", {
          body: Buffer.from(JSON.stringify(problems, null, 2)),
          contentType: "application/json",
        });
      }
      expect(problems, "fatal browser/runtime problems").toEqual([]);
    },
    async assertDetected(
      testInfo: TestInfo,
      expectedKind: Problem["kind"],
    ) {
      await testInfo.attach("runtime-problems.json", {
        body: Buffer.from(JSON.stringify(problems, null, 2)),
        contentType: "application/json",
      });
      expect(
        problems.some((problem) => problem.kind === expectedKind),
        `expected runtime guard to detect ${expectedKind}`,
      ).toBeTruthy();
      expect(
        problems.filter((problem) => problem.kind !== expectedKind),
        `unexpected runtime problems while probing ${expectedKind}`,
      ).toEqual([]);
    },
  };
}

export async function waitForYeisEngine(page: Page) {
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-engine",
    "yeis",
  );
}

export async function waitForYeis(page: Page) {
  const html = page.locator("html");
  await waitForYeisEngine(page);
  await expect(html).toHaveAttribute("data-yeis-native-galaxy", "ready");
}

export async function positiveDataset(page: Page, attribute: string) {
  const html = page.locator("html");
  await expect
    .poll(async () => Number((await html.getAttribute(attribute)) ?? "0"))
    .toBeGreaterThan(0);
  return Number((await html.getAttribute(attribute)) ?? "0");
}

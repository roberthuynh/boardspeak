import { expect, test, type Page } from "@playwright/test";

const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

async function openPlainBrowserGame(page: Page, path = "/") {
  await page.addInitScript(() => {
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: undefined,
      writable: true,
    });
  });
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "White to move" })).toBeVisible();
  await expect(page.locator(".board-square")).toHaveCount(64);
}

async function playMouseMove(page: Page, fromName: string, toName: string) {
  await page.getByRole("button", { name: fromName, exact: true }).click();
  const destination = page.getByRole("button", { name: toName, exact: true });
  await expect(destination).toHaveAttribute("data-legal-target", "true");
  await destination.click();
}

test("mouse play passes the turn and changes the agent rail", async ({ page }) => {
  await openPlainBrowserGame(page);

  const rail = page.locator(".tool-rail");
  await expect(rail.locator('[data-tool-name="suggest_move"]')).toBeVisible();
  await expect(rail.locator('[data-tool-name="play_move"]')).toHaveCount(0);

  await playMouseMove(page, "e2, white pawn", "e3, empty");
  await expect(page.getByRole("heading", { name: "Black to move" })).toBeVisible();
  await expect(rail.locator('[data-tool-name="play_move"]')).toContainText("22 legal");
  await expect(rail.locator('[data-tool-name="suggest_move"]')).toHaveCount(0);

  await playMouseMove(page, "e7, black pawn", "e6, empty");
  await expect(page.getByRole("heading", { name: "White to move" })).toBeVisible();
  await expect(rail.locator('[data-tool-name="play_move"]')).toHaveCount(0);
  await expect(rail.locator('[data-tool-name="suggest_move"]')).toBeVisible();
  await expect(page.locator(".move-entry").first()).toContainText("Black e7 moves to e6");
});

test("demo mode sends Black through the traced tool execution path", async ({ page }) => {
  await openPlainBrowserGame(page, "/?demo=1");

  const demo = page.getByRole("button", { name: "Demo: agent turn" });
  await expect(demo).toBeDisabled();
  await playMouseMove(page, "e2, white pawn", "e3, empty");
  await expect(demo).toBeEnabled();
  await expect(page.locator('[data-tool-name="play_move"]')).toBeVisible();

  await demo.click();

  await expect(page.getByRole("heading", { name: "White to move" })).toBeVisible();
  await expect(page.locator('[data-tool-name="play_move"]')).toHaveCount(0);
  await page.getByText("Agent call trace", { exact: true }).click();
  await expect(page.locator(".trace-entry").first()).toContainText("play_move");

  const newestTrace = await page.evaluate(() => {
    const state = window.__boardspeak?.getState() as
      | { trace?: Array<{ name: string; args: unknown; isError: boolean }> }
      | undefined;
    return state?.trace?.[0] ?? null;
  });
  expect(newestTrace).toMatchObject({ name: "play_move", isError: false });
});

test("practice mode gives Black a visible White bot reply", async ({ page }) => {
  await openPlainBrowserGame(page);

  const practice = page.getByRole("button", { name: "Play the board" });
  await practice.click();
  await expect(practice).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Black to move" })).toBeVisible();
  await expect(page.locator(".move-entry")).toHaveCount(1);
  await expect(page.locator(".move-entry").first()).toContainText("White a2 moves to a3");

  await playMouseMove(page, "a7, black pawn", "a6, empty");

  await expect(page.locator(".move-entry")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Black to move" })).toBeVisible();
  await expect(page.locator(".move-entry").first()).toContainText("White a3 moves to a4");
  await expect(page.locator('[data-tool-name="play_move"]')).toBeVisible();
});

test("360px layout keeps the fully named board inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openPlainBrowserGame(page);

  const squares = page.locator(".board-square");
  await expect(squares).toHaveCount(64);
  const squareSemantics = await squares.evaluateAll((buttons) =>
    buttons.map((button) => ({
      label: button.getAttribute("aria-label"),
      tagName: button.tagName,
    })),
  );
  expect(squareSemantics).toHaveLength(64);
  expect(
    squareSemantics.every(
      ({ label, tagName }) =>
        tagName === "BUTTON" &&
        Boolean(label?.match(/^[a-h][1-8], (?:white pawn|black pawn|empty)$/)),
    ),
  ).toBe(true);

  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);

  const boardBox = await page.locator(".board-frame").boundingBox();
  expect(boardBox).not.toBeNull();
  expect(boardBox!.x).toBeGreaterThanOrEqual(0);
  expect(boardBox!.x + boardBox!.width).toBeLessThanOrEqual(360);
});

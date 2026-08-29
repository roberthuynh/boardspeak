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

async function playMouseMove(page: Page, fromSquare: string, toSquare: string) {
  await page.locator(`.board-square[data-square="${fromSquare}"]`).click();
  const destination = page.locator(`.board-square[data-square="${toSquare}"]`);
  await expect(destination).toHaveAttribute("data-legal-target", "true");
  await expect(destination).toHaveAttribute(
    "aria-label",
    new RegExp(`^${toSquare}, .+, legal (?:destination|capture)$`),
  );
  await destination.click();
}

test("mouse play passes the turn and changes the agent rail", async ({ page }) => {
  await openPlainBrowserGame(page);

  const rail = page.locator(".tool-rail");
  await expect(rail.locator('[data-tool-name="suggest_move"]')).toBeVisible();
  await expect(rail.locator('[data-tool-name="play_move"]')).toHaveCount(0);

  await playMouseMove(page, "e2", "e3");
  await expect(page.getByRole("heading", { name: "Black to move" })).toBeVisible();
  await expect(rail.locator('[data-tool-name="play_move"]')).toContainText("22 legal");
  await expect(rail.locator('[data-tool-name="suggest_move"]')).toHaveCount(0);

  await playMouseMove(page, "e7", "e6");
  await expect(page.getByRole("heading", { name: "White to move" })).toBeVisible();
  await expect(rail.locator('[data-tool-name="play_move"]')).toHaveCount(0);
  await expect(rail.locator('[data-tool-name="suggest_move"]')).toBeVisible();
  await expect(page.locator(".move-entry").first()).toContainText("Black e7 moves to e6");
});

test("demo mode sends Black through the traced tool execution path", async ({ page }) => {
  await openPlainBrowserGame(page, "/?demo=1");

  const demo = page.getByRole("button", { name: "Demo: agent turn" });
  await expect(demo).toBeDisabled();
  await playMouseMove(page, "e2", "e3");
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

test("plain-browser setup can collapse without hiding the demo action", async ({
  page,
}) => {
  await openPlainBrowserGame(page, "/?demo=1");

  await expect(
    page.getByRole("heading", { name: "Voice play needs WebMCP" }),
  ).toBeVisible();
  const demo = page.getByRole("button", { name: "Demo: agent turn" });
  await expect(demo).toBeVisible();

  await page.getByRole("button", { name: "Hide setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Voice play needs WebMCP" }),
  ).toBeHidden();
  await expect(demo).toBeVisible();

  await page.getByRole("button", { name: "Show agent setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Voice play needs WebMCP" }),
  ).toBeVisible();
});

test("practice mode gives Black a visible White bot reply", async ({ page }) => {
  await openPlainBrowserGame(page);

  const practice = page.getByRole("button", { name: "Play the board" });
  await practice.click();
  await expect(practice).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Black to move" })).toBeVisible();
  await expect(page.locator(".move-entry")).toHaveCount(1);
  await expect(page.locator(".move-entry").first()).toContainText("White a2 moves to a3");

  await playMouseMove(page, "a7", "a6");

  await expect(page.locator(".move-entry")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Black to move" })).toBeVisible();
  await expect(page.locator(".move-entry").first()).toContainText("White a3 moves to a4");
  await expect(page.locator('[data-tool-name="play_move"]')).toBeVisible();
});

test("board focus and selection feedback are visible and announced", async ({ page }) => {
  await openPlainBrowserGame(page);

  const pawn = page.locator('.board-square[data-square="e2"]');
  await pawn.focus();
  const focusStyle = await pawn.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.outlineColor,
      offset: style.outlineOffset,
      width: style.outlineWidth,
    };
  });
  expect(focusStyle).toEqual({
    color: "rgb(27, 18, 6)",
    offset: "-5px",
    width: "4px",
  });

  await pawn.click();
  await expect(page.getByRole("status")).toContainText(
    "White pawn e2 selected. Legal destinations: d3, e3, f3.",
  );
  await expect(page.locator('.board-square[data-square="e3"]')).toHaveAttribute(
    "aria-label",
    "e3, empty, legal destination",
  );
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

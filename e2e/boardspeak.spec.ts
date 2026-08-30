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
  const source = page.locator(`.board-square[data-square="${fromSquare}"]`);
  await expect(source).toHaveAttribute(
    "aria-label",
    new RegExp(`^${fromSquare}, (?:white|black) pawn$`),
  );
  await source.click();
  const destination = page.locator(`.board-square[data-square="${toSquare}"]`);
  await expect(destination).toHaveAttribute("data-legal-target", "true");
  await expect(destination).toHaveAttribute(
    "aria-label",
    new RegExp(
      `^${toSquare}, (?:empty|(?:white|black) pawn), legal (?:destination|capture)$`,
    ),
  );
  await destination.click();
}

test("mouse play passes the turn and changes the agent rail", async ({ page }) => {
  await openPlainBrowserGame(page);

  const rail = page.locator(".tool-rail");
  await expect(page.getByText(/White uses the mouse:/)).toContainText(
    "click a White pawn, then a highlighted square. Or turn on Bot plays White.",
  );
  await expect(page.locator('.player-input-map [data-active="true"]')).toContainText(
    "White",
  );
  await expect(page.locator('.player-input-map [data-active="true"]')).toContainText(
    "Mouse",
  );
  await expect(rail.locator('[data-tool-name="suggest_move"]')).toBeVisible();
  await expect(rail.locator('[data-tool-name="play_move"]')).toHaveCount(0);

  await playMouseMove(page, "e2", "e3");
  await expect(page.getByRole("heading", { name: "Black to move" })).toBeVisible();
  await expect(page.getByText(/Black uses voice or an agent:/)).toBeVisible();
  await expect(page.locator('.player-input-map [data-active="true"]')).toContainText(
    "Voice / agent",
  );
  await expect(rail.locator('[data-tool-name="play_move"]')).toContainText("22 legal");
  await expect(rail.locator('[data-tool-name="suggest_move"]')).toHaveCount(0);

  await playMouseMove(page, "e7", "e6");
  await expect(page.getByRole("heading", { name: "White to move" })).toBeVisible();
  await expect(page.getByText(/White uses the mouse:/)).toBeVisible();
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

test("plain Chrome speech plays a current legal Black move through the trace", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class FakeSpeechRecognition {
      static active: FakeSpeechRecognition | null = null;
      continuous = false;
      interimResults = false;
      lang = "";
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult: ((event: {
        results: ArrayLike<{ length: number; 0: { transcript: string } }>;
      }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;

      constructor() {
        FakeSpeechRecognition.active = this;
      }

      start() {
        this.onstart?.();
      }

      abort() {
        this.onerror?.({ error: "aborted" });
      }
    }

    Object.defineProperty(window, "__emitBoardspeakSpeech", {
      configurable: true,
      value: () => {
        FakeSpeechRecognition.active?.onresult?.({
          results: [{ 0: { transcript: "e seven to e six" }, length: 1 }],
        });
        FakeSpeechRecognition.active?.onend?.();
      },
    });

    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: FakeSpeechRecognition,
    });
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeSpeechRecognition,
    });
  });
  await openPlainBrowserGame(page);
  await playMouseMove(page, "e2", "e3");

  const mic = page.getByRole("button", { name: "Speak Black move" });
  await expect(mic).toBeEnabled();
  await mic.click();
  await expect(page.getByRole("button", { name: "Stop listening" })).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as {
        __emitBoardspeakSpeech: () => void;
      }
    ).__emitBoardspeakSpeech(),
  );
  await expect(page.getByRole("heading", { name: "White to move" })).toBeVisible();
  await expect(page.locator(".move-entry").first()).toContainText(
    "Black e7 moves to e6",
  );
  await page.getByText("Agent call trace", { exact: true }).click();
  await expect(page.locator(".trace-entry").first()).toContainText("play_move");
  await expect(page.locator(".trace-entry").first()).toContainText("e7-e6");
});

test("plain browsers without speech recognition keep a clear Black fallback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: undefined,
    });
  });
  await openPlainBrowserGame(page);
  await playMouseMove(page, "e2", "e3");

  await expect(page.getByRole("button", { name: "Mic unavailable" })).toBeDisabled();
  await expect(
    page.getByText(
      "Voice input is unavailable here. Move Black with an agent or the mouse.",
    ),
  ).toBeVisible();
});

test("plain-browser setup can collapse without hiding the demo action", async ({
  page,
}) => {
  await openPlainBrowserGame(page, "/?demo=1");

  await expect(
    page.getByRole("heading", { name: "Agent play needs WebMCP" }),
  ).toBeVisible();
  const demo = page.getByRole("button", { name: "Demo: agent turn" });
  await expect(demo).toBeVisible();
  await expect(page.getByText("Plain browser mode")).toBeVisible();

  const bannerListStyle = await page
    .locator(".agent-banner ol")
    .evaluate((list) => getComputedStyle(list).listStyleType);
  expect(bannerListStyle).toBe("decimal");

  const disabledDemoStyle = await demo.evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      background: style.backgroundColor,
      color: style.color,
      opacity: style.opacity,
    };
  });
  expect(disabledDemoStyle).toEqual({
    background: "rgb(113, 51, 38)",
    color: "rgb(216, 193, 183)",
    opacity: "1",
  });

  await page.getByRole("button", { name: "Hide setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Agent play needs WebMCP" }),
  ).toBeHidden();
  await expect(demo).toBeVisible();
  await expect(page.getByText("Plain browser mode")).toBeVisible();

  await page.getByRole("button", { name: "Show agent setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Agent play needs WebMCP" }),
  ).toBeVisible();

  await page.getByText("How to play").click();
  const rulesListStyle = await page
    .locator(".how-to-play ol")
    .evaluate((list) => getComputedStyle(list).listStyleType);
  expect(rulesListStyle).toBe("decimal");
});

test("practice mode gives Black a visible White bot reply", async ({ page }) => {
  await openPlainBrowserGame(page);

  const practice = page.getByRole("button", { name: "Bot plays White" });
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

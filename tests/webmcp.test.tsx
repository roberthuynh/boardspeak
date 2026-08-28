// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Game } from "@/components/Game";
import {
  applyMove,
  legalMoves,
  winner,
  type GameState,
  type Move,
} from "@/lib/breakthrough";
import type { SessionState } from "@/lib/game";

const INITIAL_WHITE_SURFACE = [
  "describe_board",
  "get_rules",
  "list_legal_moves",
  "suggest_move",
  "resign_game",
  "start_new_game",
] as const;

interface MoveSchema {
  properties?: {
    move?: {
      enum?: readonly string[];
    };
  };
}

class StrictModelContext extends EventTarget implements WebMCPModelContext {
  readonly active = new Map<string, WebMCPToolDefinition>();
  readonly duplicateErrors: DOMException[] = [];

  registerTool(
    tool: WebMCPToolDefinition,
    options?: { readonly signal?: AbortSignal },
  ): void {
    if (options?.signal?.aborted) {
      return;
    }

    if (this.active.has(tool.name)) {
      const error = new DOMException(
        `A tool named ${tool.name} is already registered.`,
        "InvalidStateError",
      );
      this.duplicateErrors.push(error);
      throw error;
    }

    this.active.set(tool.name, tool);
    options?.signal?.addEventListener(
      "abort",
      () => {
        if (this.active.get(tool.name) === tool) {
          this.active.delete(tool.name);
        }
      },
      { once: true },
    );
  }

  names(): string[] {
    return [...this.active.keys()];
  }

  tool(name: string): WebMCPToolDefinition {
    const tool = this.active.get(name);
    if (!tool) {
      throw new Error(`${name} is not registered.`);
    }
    return tool;
  }
}

function installDialogPrimitives() {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement, returnValue = "") {
      if (returnValue) {
        this.returnValue = returnValue;
      }
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
}

function currentSession(): SessionState {
  const state = window.__boardspeak?.getState();
  if (!state) {
    throw new Error("Boardspeak test API is not ready.");
  }
  return state as SessionState;
}

function moveEnum(tool: WebMCPToolDefinition): readonly string[] {
  const schema = tool.inputSchema as MoveSchema | undefined;
  return schema?.properties?.move?.enum ?? [];
}

function boardButton(container: HTMLElement, square: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `button[data-square="${square}"]`,
  );
  if (!button) {
    throw new Error(`Board button ${square} was not rendered.`);
  }
  return button;
}

function beginToolExecution(tool: WebMCPToolDefinition, args: unknown): Promise<unknown> {
  let execution: Promise<unknown> | undefined;
  act(() => {
    execution = Promise.resolve(tool.execute(args));
  });
  return execution!;
}

function chooseLongGameMove(position: GameState): Move {
  const side = position.sideToMove;
  const safeQuietMoves = legalMoves(position, side).filter(
    (move) => !move.capture && winner(applyMove(position, move)) === null,
  );
  const candidates = safeQuietMoves.length > 0 ? safeQuietMoves : legalMoves(position, side);

  const sorted = [...candidates].sort((left, right) => {
    const leftRank = Number(left.from[1]);
    const rightRank = Number(right.from[1]);
    const homeRankOrder = side === "white" ? leftRank - rightRank : rightRank - leftRank;
    return homeRankOrder || left.notation.localeCompare(right.notation);
  });
  const move = sorted[0];
  if (!move) {
    throw new Error(`${side} unexpectedly has no move.`);
  }
  return move;
}

async function playWhiteWithMouse(container: HTMLElement, move: Move) {
  fireEvent.click(boardButton(container, move.from));
  await waitFor(() =>
    expect(boardButton(container, move.to)).toHaveAttribute("data-legal-target", "true"),
  );
  fireEvent.click(boardButton(container, move.to));
  await waitFor(() => expect(currentSession().position.lastMove?.notation).toBe(move.notation));
}

describe("the live WebMCP tool surface", () => {
  let modelContext: StrictModelContext;

  beforeEach(() => {
    installDialogPrimitives();
    modelContext = new StrictModelContext();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: modelContext,
    });
    delete document.documentElement.dataset.boardspeakNativeWebmcp;
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    delete window.__boardspeak;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: undefined,
    });
    delete document.documentElement.dataset.boardspeakNativeWebmcp;
  });

  it("regenerates the exact move enum, commits agent play, and traces it", async () => {
    const { container } = render(<Game />);

    await waitFor(() => expect(modelContext.names()).toEqual(INITIAL_WHITE_SURFACE));
    expect(modelContext.active.has("play_move")).toBe(false);
    expect(modelContext.active.has("play_capture")).toBe(false);
    expect(modelContext.active.has("list_threats")).toBe(false);

    await playWhiteWithMouse(
      container,
      legalMoves(currentSession().position, "white").find(
        (move) => move.notation === "e2-e3",
      )!,
    );

    await waitFor(() => expect(modelContext.active.has("play_move")).toBe(true));
    const currentBlackMoves = legalMoves(currentSession().position, "black").map(
      (move) => move.notation,
    );
    expect(currentBlackMoves).toHaveLength(22);
    expect(moveEnum(modelContext.tool("play_move"))).toEqual(currentBlackMoves);

    const played = currentBlackMoves[0]!;
    const execution = beginToolExecution(modelContext.tool("play_move"), { move: played });

    await waitFor(() => expect(modelContext.active.has("play_move")).toBe(false));
    await waitFor(() => expect(currentSession().trace).toHaveLength(1));
    await execution;
    expect(currentSession().position.sideToMove).toBe("white");
    expect(currentSession().position.lastMove?.notation).toBe(played);
    expect(screen.getByRole("heading", { name: "White to move" })).toBeVisible();
    expect(container.querySelector('.trace-entry code')?.textContent).toBe("play_move");
    expect(modelContext.duplicateErrors).toEqual([]);
  });

  it(
    "survives 20 plies and a tool-driven new game without duplicate registration",
    async () => {
      const { container } = render(<Game />);
      await waitFor(() =>
        expect([...modelContext.names()].sort()).toEqual([...INITIAL_WHITE_SURFACE].sort()),
      );
      let expectedTraceCount = 0;

      for (let ply = 0; ply < 20; ply += 1) {
        const before = currentSession();
        const move = chooseLongGameMove(before.position);

        if (before.position.sideToMove === "white") {
          await playWhiteWithMouse(container, move);
        } else {
          await waitFor(() => expect(modelContext.active.has("play_move")).toBe(true));
          expect(moveEnum(modelContext.tool("play_move"))).toContain(move.notation);
          const execution = beginToolExecution(modelContext.tool("play_move"), {
            move: move.notation,
          });
          await waitFor(() =>
            expect(currentSession().position.lastMove?.notation).toBe(move.notation),
          );
          expectedTraceCount += 1;
          await waitFor(() => expect(currentSession().trace).toHaveLength(expectedTraceCount));
          await execution;
        }

        expect(currentSession().history).toHaveLength(ply + 1);
        expect(currentSession().outcome).toBeNull();
        expect(modelContext.duplicateErrors).toEqual([]);
      }

      expect(currentSession().position.sideToMove).toBe("white");
      const startTool = modelContext.tool("start_new_game");
      const startPromise = beginToolExecution(startTool, {});

      const dialog = (await screen.findByRole("dialog")) as HTMLDialogElement;
      await waitFor(() => expect(dialog).toHaveAttribute("open"));
      dialog.returnValue = "confirm";
      fireEvent(dialog, new Event("close"));

      await waitFor(() => expect(currentSession().history).toHaveLength(0));
      expectedTraceCount += 1;
      await waitFor(() => expect(currentSession().trace).toHaveLength(expectedTraceCount));
      await startPromise;
      await waitFor(() =>
        expect([...modelContext.names()].sort()).toEqual([...INITIAL_WHITE_SURFACE].sort()),
      );
      expect(currentSession().position.moveNumber).toBe(1);
      expect(currentSession().position.sideToMove).toBe("white");
      expect(modelContext.duplicateErrors).toEqual([]);
    },
    30_000,
  );
});

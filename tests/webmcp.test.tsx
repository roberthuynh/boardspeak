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
  type Square,
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

function toolResponse(result: unknown): {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly isError?: boolean;
} {
  if (!result || typeof result !== "object" || !("content" in result)) {
    throw new Error("Tool did not return a normalized WebMCP response.");
  }
  return result as {
    readonly content: readonly { readonly type: string; readonly text?: string }[];
    readonly isError?: boolean;
  };
}

function toolPayload<T>(result: unknown): T {
  const text = toolResponse(result).content[0]?.text;
  if (!text) {
    throw new Error("Tool response did not contain JSON text.");
  }
  return JSON.parse(text) as T;
}

function highMobilityPosition(): GameState {
  const rows = [
    { files: "bcdefg", rank: 7 },
    { files: "bcdefg", rank: 5 },
    { files: "bcde", rank: 3 },
  ] as const;
  const blackPieces = rows.flatMap(({ files, rank }) =>
    [...files].map((file) => ({
      id: `black-${file}${rank}`,
      side: "black" as const,
      square: `${file}${rank}` as Square,
    })),
  );

  return {
    pieces: [
      ...blackPieces,
      { id: "white-a1", side: "white", square: "a1" },
    ],
    sideToMove: "black",
    moveNumber: 12,
    lastMove: null,
    captured: { white: 15, black: 0 },
  };
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

async function playBlackWithTool(notation: string) {
  const tool = document.modelContext as StrictModelContext;
  const execution = beginToolExecution(tool.tool("play_move"), { move: notation });
  await execution;
  await waitFor(() =>
    expect(currentSession().position.lastMove?.notation).toBe(notation),
  );
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

  it("returns the root move list in the normalized response budget", async () => {
    render(<Game />);
    await waitFor(() => expect(modelContext.active.has("list_legal_moves")).toBe(true));

    const result = await beginToolExecution(
      modelContext.tool("list_legal_moves"),
      {},
    );
    const response = toolResponse(result);
    const payload = toolPayload<{
      gameOver: boolean;
      winner: string | null;
      total: number;
      returned: number;
      truncated: boolean;
      moves: Record<string, string[]>;
    }>(result);

    expect(response.content).toHaveLength(1);
    expect(response.content[0]?.type).toBe("text");
    expect(JSON.stringify(response).length).toBeLessThanOrEqual(1_500);
    expect(payload).toMatchObject({
      gameOver: false,
      winner: null,
      total: 22,
      returned: 22,
      truncated: false,
    });
    expect(Object.values(payload.moves).flat()).toHaveLength(22);
  });

  it("normalizes a valid 48-move position without truncation", async () => {
    const position = highMobilityPosition();
    render(<Game initialPosition={position} />);
    await waitFor(() => expect(modelContext.active.has("list_legal_moves")).toBe(true));

    const result = await beginToolExecution(
      modelContext.tool("list_legal_moves"),
      {},
    );
    const payload = toolPayload<{
      gameOver: boolean;
      winner: string | null;
      total: number;
      returned: number;
      truncated: boolean;
      moves: Record<string, string[]>;
    }>(result);

    expect(legalMoves(position, "black")).toHaveLength(48);
    expect(payload).toEqual(
      expect.objectContaining({
        gameOver: false,
        winner: null,
        total: 48,
        returned: 48,
        truncated: false,
      }),
    );
    expect(Object.values(payload.moves).flat()).toHaveLength(48);
    expect(JSON.stringify(toolResponse(result)).length).toBeLessThanOrEqual(1_500);
    await waitFor(() => expect(currentSession().trace).toHaveLength(1));
    expect(currentSession().trace[0]).toMatchObject({
      name: "list_legal_moves",
      isError: false,
    });
    expect(modelContext.duplicateErrors).toEqual([]);
  });

  it("rejects an oversized play result before mutating the board", async () => {
    const position = highMobilityPosition();
    render(<Game initialPosition={position} toolOutputLimit={120} />);
    await waitFor(() => expect(modelContext.active.has("play_move")).toBe(true));
    const move = moveEnum(modelContext.tool("play_move"))[0];
    if (!move) throw new Error("Missing high-mobility fixture move.");

    const result = await beginToolExecution(
      modelContext.tool("play_move"),
      { move },
    );

    expect(toolResponse(result).isError).toBe(true);
    expect(toolResponse(result).content[0]?.text).toMatch(
      /play_move could not return a compact result/i,
    );
    await waitFor(() => expect(currentSession().trace).toHaveLength(1));
    expect(currentSession().position.sideToMove).toBe("black");
    expect(currentSession().position.lastMove).toBeNull();
    expect(currentSession().history).toHaveLength(0);
    expect(currentSession().trace[0]).toMatchObject({
      name: "play_move",
      isError: true,
    });
    expect(modelContext.active.has("play_move")).toBe(true);
  });

  it("keeps resignation and describe_board session outcomes consistent", async () => {
    render(<Game />);
    await waitFor(() => expect(modelContext.active.has("resign_game")).toBe(true));

    const resignExecution = beginToolExecution(modelContext.tool("resign_game"), {});
    const dialog = (await screen.findByRole("dialog")) as HTMLDialogElement;
    await waitFor(() => expect(dialog).toHaveAttribute("open"));
    dialog.returnValue = "confirm";
    fireEvent(dialog, new Event("close"));

    const resignResult = await resignExecution;
    const resignation = toolPayload<{ board: string; winner: string }>(resignResult);
    await waitFor(() =>
      expect(currentSession().outcome).toEqual({
        winner: "white",
        reason: "resignation",
      }),
    );

    const describeResult = await beginToolExecution(
      modelContext.tool("describe_board"),
      {},
    );
    const description = toolPayload<{
      board: string;
      snapshot: { winner: string | null };
      outcome: { winner: string; reason: string } | null;
    }>(describeResult);
    const legalMoveResult = await beginToolExecution(
      modelContext.tool("list_legal_moves"),
      {},
    );
    const moveList = toolPayload<{
      gameOver: boolean;
      winner: string | null;
      total: number;
      returned: number;
      moves: Record<string, string[]>;
    }>(legalMoveResult);

    expect(resignation.winner).toBe("white");
    expect(resignation.board).toContain("Winner: White (resignation).");
    expect(description.board).toContain("Winner: White (resignation).");
    expect(description.snapshot.winner).toBe("white");
    expect(description.outcome).toEqual({
      winner: "white",
      reason: "resignation",
    });
    expect(moveList).toMatchObject({
      gameOver: true,
      winner: "white",
      total: 0,
      returned: 0,
    });
    expect(Object.values(moveList.moves).flat()).toEqual([]);
  });

  it("unregisters threats at game end and rejects a stale threat call", async () => {
    const { container } = render(<Game />);
    await waitFor(() => expect(modelContext.names()).toEqual(INITIAL_WHITE_SURFACE));

    const whiteMoves = ["a2-a3", "a3-a4", "a4-a5", "a5-a6", "a6-a7"];
    const blackMoves = ["a7-b6", "h7-h6", "h6-h5", "h5-h4"];

    for (let index = 0; index < whiteMoves.length; index += 1) {
      const notation = whiteMoves[index]!;
      const whiteMove = legalMoves(currentSession().position, "white").find(
        (move) => move.notation === notation,
      );
      if (!whiteMove) throw new Error(`Missing test move ${notation}`);
      await playWhiteWithMouse(container, whiteMove);

      const blackMove = blackMoves[index];
      if (blackMove) {
        await playBlackWithTool(blackMove);
      }
    }

    await waitFor(() => expect(modelContext.active.has("list_threats")).toBe(true));
    const staleThreatTool = modelContext.tool("list_threats");

    const resignExecution = beginToolExecution(modelContext.tool("resign_game"), {});
    const dialog = (await screen.findByRole("dialog")) as HTMLDialogElement;
    await waitFor(() => expect(dialog).toHaveAttribute("open"));
    dialog.returnValue = "confirm";
    fireEvent(dialog, new Event("close"));
    await resignExecution;

    await waitFor(() => expect(modelContext.active.has("list_threats")).toBe(false));
    expect(
      currentSession().registry.some((tool) => tool.name === "list_threats"),
    ).toBe(false);

    const staleResult = await beginToolExecution(staleThreatTool, {});
    const staleResponse = toolResponse(staleResult);
    expect(staleResponse.isError).toBe(true);
    expect(staleResponse.content[0]?.text).toMatch(
      /game is over; call start_new_game before listing threats/i,
    );
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

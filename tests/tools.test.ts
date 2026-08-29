import { describe, expect, it } from "vitest";
import {
  applyMove,
  initialState,
  legalMoves,
  type GameState,
  type Square,
} from "@/lib/breakthrough";
import { createEvalPosition } from "@/lib/game";
import {
  EMPTY_INPUT_SCHEMA,
  MAX_TOOL_OUTPUT_LENGTH,
  TOOL_META,
  buildToolRegistry,
  compactLegalMoves,
  moveArg,
  moveInputSchema,
  shouldExposeBoardspeakTestApi,
  tagMoves,
  toolOutputLength,
} from "@/lib/tools";

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

describe("WebMCP tool contracts", () => {
  it("stays within browser discovery limits", () => {
    for (const tool of Object.values(TOOL_META)) {
      expect(tool.name.length).toBeLessThanOrEqual(30);
      expect(tool.description.length).toBeLessThanOrEqual(500);
    }

    const schema = moveInputSchema(legalMoves(initialState(), "white"));
    expect(schema.properties.move.description.length).toBeLessThanOrEqual(150);
  });

  it("uses strict object schemas with explicit required arrays", () => {
    const schemas = [
      EMPTY_INPUT_SCHEMA,
      moveInputSchema(legalMoves(initialState(), "white")),
    ];

    for (const schema of schemas) {
      expect(schema.type).toBe("object");
      expect(schema.required).toBeInstanceOf(Array);
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it("changes the intended surface in the same state transition", () => {
    const initial = initialState();
    const whiteRegistry = buildToolRegistry(initial, null);
    const whiteMove = legalMoves(initial, "white").find(
      (move) => move.notation === "e2-e3",
    );
    if (!whiteMove) throw new Error("Missing fixture move");
    const afterWhite = applyMove(initial, whiteMove);
    const blackRegistry = buildToolRegistry(afterWhite, null);

    expect(whiteRegistry.some((tool) => tool.name === "suggest_move")).toBe(true);
    expect(whiteRegistry.some((tool) => tool.name === "play_move")).toBe(false);
    expect(blackRegistry.some((tool) => tool.name === "suggest_move")).toBe(false);
    expect(
      blackRegistry.find((tool) => tool.name === "play_move")?.detail,
    ).toBe("22 legal");
  });

  it("adds the capture shortcut only when a Black capture exists", () => {
    const registry = buildToolRegistry(createEvalPosition(), null);
    expect(registry.find((tool) => tool.name === "play_capture")?.detail).toBe(
      "1 capture",
    );
  });

  it("tags off-turn Black moves without mutating the live turn", () => {
    const state = initialState();
    const tagged = tagMoves(state, legalMoves(state, "black"));

    expect(tagged).toHaveLength(22);
    expect(tagged.every((entry) => entry.tag === "advance")).toBe(true);
    expect(state.sideToMove).toBe("white");
  });

  it("measures the normalized response envelope the agent receives", () => {
    const payload = { message: 'A quoted "move"' };
    const normalized = {
      content: [{ type: "text", text: JSON.stringify(payload) }],
    };

    expect(toolOutputLength(payload)).toBe(JSON.stringify(normalized).length);
    expect(toolOutputLength(payload)).toBeGreaterThan(JSON.stringify(payload).length);
  });

  it("returns 48 bare move notations within the normalized output budget", () => {
    const state = highMobilityPosition();
    const legal = legalMoves(state, "black");
    const moveList = compactLegalMoves(
      state.sideToMove,
      true,
      tagMoves(state, legal),
    );

    expect(legal).toHaveLength(48);
    expect(moveList).toMatchObject({
      total: 48,
      returned: 48,
      truncated: false,
    });
    expect(Object.values(moveList.moves).flat()).toHaveLength(48);
    expect(
      Object.values(moveList.moves).flat().every((move) => typeof move === "string"),
    ).toBe(true);
    expect(toolOutputLength(moveList)).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
  });

  it("truncates deterministically before the normalized output budget", () => {
    const moves = Array.from({ length: 48 }, (_, index) => ({
      move: `long-move-notation-${index.toString().padStart(2, "0")}`,
      tag: index % 2 === 0 ? ("advance" as const) : ("capture" as const),
    }));
    const first = compactLegalMoves("black", true, moves, 420);
    const second = compactLegalMoves("black", true, moves, 420);

    expect(first).toEqual(second);
    expect(first.returned).toBeGreaterThan(0);
    expect(first.returned).toBeLessThan(first.total);
    expect(first.truncated).toBe(true);
    expect(toolOutputLength(first)).toBeLessThanOrEqual(420);
  });

  it("points move validation at the correct recovery surface", () => {
    const allowed = legalMoves(initialState(), "white");

    expect(() => moveArg({ move: "z9-z8" }, allowed, "suggest_move")).toThrow(
      /suggest_move's current move enum/i,
    );
    expect(() => moveArg({ move: "z9-z8" }, allowed, "play_move")).toThrow(
      /call list_legal_moves/i,
    );
  });

  it("removes threats from the intended registry after a session outcome", () => {
    const threatened: GameState = {
      pieces: [
        { id: "white-b7", side: "white", square: "b7" },
        { id: "black-h8", side: "black", square: "h8" },
      ],
      sideToMove: "white",
      moveNumber: 9,
      lastMove: null,
      captured: { white: 15, black: 15 },
    };

    expect(
      buildToolRegistry(threatened, null).some(
        (tool) => tool.name === "list_threats",
      ),
    ).toBe(true);
    expect(
      buildToolRegistry(threatened, "white").some(
        (tool) => tool.name === "list_threats",
      ),
    ).toBe(false);
  });

  it("exposes the test hook only outside production or in eval mode", () => {
    expect(shouldExposeBoardspeakTestApi("test", false)).toBe(true);
    expect(shouldExposeBoardspeakTestApi("development", false)).toBe(true);
    expect(shouldExposeBoardspeakTestApi("production", false)).toBe(false);
    expect(shouldExposeBoardspeakTestApi("production", true)).toBe(true);
  });
});

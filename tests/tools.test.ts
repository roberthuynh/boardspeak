import { describe, expect, it } from "vitest";
import { applyMove, initialState, legalMoves } from "@/lib/breakthrough";
import { createEvalPosition } from "@/lib/game";
import {
  EMPTY_INPUT_SCHEMA,
  TOOL_META,
  buildToolRegistry,
  moveInputSchema,
  tagMoves,
  toolOutputLength,
} from "@/lib/tools";

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

  it("keeps representative tool payloads below 1500 characters", () => {
    const state = initialState();
    const moveList = {
      turn: state.sideToMove,
      canPlayNow: false,
      moves: tagMoves(state, legalMoves(state, "black")).map(({ move, tag }) => ({
        move,
        tag,
      })),
    };

    expect(toolOutputLength(moveList)).toBeLessThanOrEqual(1_500);
  });
});

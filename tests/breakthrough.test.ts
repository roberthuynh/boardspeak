import { describe, expect, it } from "vitest";

import { chooseBotMove } from "@/lib/bot";
import {
  applyMove,
  initialState,
  legalMoves,
  threats,
  toJSON,
  toText,
  winner,
  type GameState,
  type Piece,
  type Side,
  type Square,
} from "@/lib/breakthrough";

function position(
  pieces: Array<[Side, Square]>,
  turn: Side = "white",
): GameState {
  const numberedPieces: Piece[] = pieces.map(([side, square], index) => ({
    id: `${side}-${square}-${index}`,
    side,
    square,
  }));

  return {
    pieces: numberedPieces,
    sideToMove: turn,
    moveNumber: 1,
    lastMove: null,
    captured: {
      white: 16 - numberedPieces.filter((piece) => piece.side === "white").length,
      black: 16 - numberedPieces.filter((piece) => piece.side === "black").length,
    },
  };
}

function notations(state: GameState, side: Side): string[] {
  return legalMoves(state, side).map((move) => move.notation);
}

describe("Breakthrough engine", () => {
  it("starts with 16 stable pieces per side and 22 legal moves for each side", () => {
    const state = initialState();

    expect(state.pieces.filter((piece) => piece.side === "white")).toHaveLength(16);
    expect(state.pieces.filter((piece) => piece.side === "black")).toHaveLength(16);
    expect(new Set(state.pieces.map((piece) => piece.id)).size).toBe(32);
    expect(legalMoves(state, "white")).toHaveLength(22);
    expect(legalMoves(state, "black")).toHaveLength(22);
  });

  it("allows captures diagonally forward and never straight forward", () => {
    const state = position([
      ["white", "d4"],
      ["black", "c5"],
      ["black", "d5"],
      ["black", "h8"],
    ]);

    expect(notations(state, "white")).toContain("d4xc5");
    expect(notations(state, "white")).not.toContain("d4xd5");
    expect(notations(state, "white")).not.toContain("d4-d5");
  });

  it("blocks a straight move when either color occupies the destination", () => {
    const enemyBlocked = position([
      ["white", "d4"],
      ["black", "d5"],
      ["black", "h8"],
    ]);
    const friendlyBlocked = position([
      ["white", "d4"],
      ["white", "d5"],
      ["black", "h8"],
    ]);

    expect(notations(enemyBlocked, "white")).not.toContain("d4-d5");
    expect(notations(friendlyBlocked, "white")).not.toContain("d4-d5");
  });

  it("keeps a quiet diagonal or straight move legal while a capture exists", () => {
    const state = position([
      ["white", "d4"],
      ["black", "c5"],
      ["black", "h8"],
    ]);
    const moves = notations(state, "white");

    expect(moves).toContain("d4xc5");
    expect(moves).toContain("d4-d5");
    expect(moves).toContain("d4-e5");
  });

  it("moves without chess or checkers exceptions", () => {
    const moves = notations(initialState(), "white");

    expect(moves).toContain("a2-a3");
    expect(moves).toContain("a2-b3");
    expect(moves).not.toContain("a2-a4");
    expect(moves.every((notation) => !notation.includes("1-"))).toBe(true);
  });

  it("preserves a piece id when it moves", () => {
    const initial = initialState();
    const movingPiece = initial.pieces.find((piece) => piece.square === "e2");
    const next = applyMove(initial, "e2-e3");

    expect(next.pieces.find((piece) => piece.square === "e3")?.id).toBe(
      movingPiece?.id,
    );
    expect(next.sideToMove).toBe("black");
    expect(next.moveNumber).toBe(2);
    expect(next.lastMove?.notation).toBe("e2-e3");
  });

  it("wins immediately on reaching the far rank", () => {
    const state = position([
      ["white", "d7"],
      ["black", "h7"],
    ]);
    const result = applyMove(state, "d7-d8");

    expect(winner(result)).toBe("white");
  });

  it("wins by capturing the opponent's final pawn", () => {
    const state = position([
      ["white", "d4"],
      ["black", "e5"],
    ]);
    const result = applyMove(state, "d4xe5");

    expect(result.captured.black).toBe(16);
    expect(winner(result)).toBe("white");
  });

  it("rejects stale, backward, sideways, and out-of-turn moves", () => {
    const state = initialState();

    expect(() => applyMove(state, "e7-e6")).toThrow(/not legal for white now/i);
    expect(() => applyMove(state, "e2-e1")).toThrow(/not legal/i);
    expect(() => applyMove(state, "e2-f2")).toThrow(/not legal/i);
  });

  it("detects both colors one step from their goal", () => {
    const state = position([
      ["white", "b7"],
      ["white", "a6"],
      ["black", "g2"],
      ["black", "h3"],
    ]);

    expect(threats(state)).toEqual([
      expect.objectContaining({ side: "white", square: "b7", goalRank: 8 }),
      expect.objectContaining({ side: "black", square: "g2", goalRank: 1 }),
    ]);
  });

  it("serializes a compact, deterministic board description", () => {
    const state = applyMove(initialState(), "e2-e3");
    const text = toText(state);
    const snapshot = toJSON(state);

    expect(text.length).toBeLessThan(1_200);
    expect(text).toContain("White (16): a1, a2");
    expect(text).toContain("Side to move: black. Move number: 2.");
    expect(text).toContain("Last move: e2-e3.");
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.pieces.white).toContain("e3");
  });

  it("generates moves in deterministic source-then-destination order", () => {
    const moves = legalMoves(initialState(), "white");

    expect(moves.slice(0, 3).map((move) => move.notation)).toEqual([
      "a2-a3",
      "a2-b3",
      "b2-a3",
    ]);
  });
});

describe("White bot", () => {
  it("takes an available winning move before every other option", () => {
    const state = position([
      ["white", "a5"],
      ["white", "d7"],
      ["black", "h7"],
    ]);

    expect(chooseBotMove(state)?.notation).toBe("d7-c8");
  });

  it("prefers a capture when no move wins", () => {
    const state = position([
      ["white", "a3"],
      ["white", "d4"],
      ["black", "e5"],
      ["black", "h7"],
    ]);

    expect(chooseBotMove(state)?.notation).toBe("d4xe5");
  });

  it("advances the furthest pawn and uses notation as a stable tie-breaker", () => {
    const state = position([
      ["white", "c4"],
      ["white", "f4"],
      ["white", "a2"],
      ["black", "h7"],
    ]);

    expect(chooseBotMove(state)?.notation).toBe("c4-b5");
  });

  it("only acts on White's live turn", () => {
    expect(
      chooseBotMove(
        position(
          [
            ["white", "a2"],
            ["black", "h7"],
          ],
          "black",
        ),
      ),
    ).toBeNull();
  });
});

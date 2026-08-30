import { describe, expect, it } from "vitest";
import {
  initialState,
  legalMoves,
  type GameState,
  type Square,
} from "@/lib/breakthrough";
import { compactLegalMoves, tagMoves } from "@/lib/tools";
import {
  buildSpokenMoveOptions,
  isVoiceOptionsCommand,
  matchSpokenMove,
  spokenMoveExample,
} from "@/lib/voice-input";

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

function legalMoveOutput(state: GameState) {
  const moves = legalMoves(state, "black");

  return compactLegalMoves(
    {
      turn: state.sideToMove,
      canPlayNow: state.sideToMove === "black",
      gameOver: false,
      winner: null,
    },
    tagMoves(state, moves),
  );
}

function occurrenceCount(text: string, phrase: string): number {
  return text.split(phrase).length - 1;
}

describe("Black voice move matching", () => {
  it("matches spoken advances and captures against the supplied live enum", () => {
    const legal = ["e7-e6", "e7xd6"];

    expect(matchSpokenMove("e seven to e six", legal)).toBe("e7-e6");
    expect(matchSpokenMove("E7 takes D6", legal)).toBe("e7xd6");
    expect(matchSpokenMove("ee seven to ee six", legal)).toBe("e7-e6");
    expect(spokenMoveExample("e7xd6")).toBe("e7 takes d6");
  });

  it("rejects partial, illegal, and ambiguous speech", () => {
    expect(matchSpokenMove("move e7", ["e7-e6"])).toBeNull();
    expect(matchSpokenMove("d7 to d6", ["e7-e6"])).toBeNull();
    expect(
      matchSpokenMove("e7 to e6 or d7 to d6", ["e7-e6", "d7-d6"]),
    ).toBeNull();
  });

  it("recognizes only the standalone options keyword", () => {
    expect(isVoiceOptionsCommand("options")).toBe(true);
    expect(isVoiceOptionsCommand("  OPTIONS.  ")).toBe(true);
    expect(isVoiceOptionsCommand("options!")).toBe(true);

    expect(isVoiceOptionsCommand("show options")).toBe(false);
    expect(isVoiceOptionsCommand("what are my options?")).toBe(false);
    expect(isVoiceOptionsCommand("options e7 to e6")).toBe(false);
    expect(isVoiceOptionsCommand("what else can I do")).toBe(false);
  });

  it("builds complete deterministic move groups within the speech limit", () => {
    const initial = legalMoveOutput(initialState());
    const initialSpeech = buildSpokenMoveOptions(initial);

    expect(initial.total).toBe(22);
    expect(initial.returned).toBe(initial.total);
    expect(initial.truncated).toBe(false);
    expect(Object.values(initial.moves).flat()).toHaveLength(initial.total);
    expect(initialSpeech.total).toBe(22);
    expect(initialSpeech.chunks.every((chunk) => chunk.length <= 180)).toBe(
      true,
    );
    expect(initialSpeech.fullText).toBe(initialSpeech.chunks.join(" "));
    expect(initialSpeech.fullText).toContain("Black has 22 legal moves.");
    for (const notation of Object.values(initial.moves).flat()) {
      expect(
        occurrenceCount(initialSpeech.fullText, spokenMoveExample(notation)),
      ).toBe(1);
    }

    const highMobility = legalMoveOutput(highMobilityPosition());
    const first = buildSpokenMoveOptions(highMobility);
    const second = buildSpokenMoveOptions(highMobility);
    const tightlyChunked = buildSpokenMoveOptions(highMobility, 48);

    expect(highMobility.total).toBe(48);
    expect(highMobility.returned).toBe(highMobility.total);
    expect(highMobility.truncated).toBe(false);
    expect(Object.values(highMobility.moves).flat()).toHaveLength(
      highMobility.total,
    );
    expect(first).toEqual(second);
    expect(first.total).toBe(48);
    expect(first.chunks.every((chunk) => chunk.length <= 180)).toBe(true);
    expect(tightlyChunked.chunks.every((chunk) => chunk.length <= 48)).toBe(
      true,
    );
    expect(
      tightlyChunked.chunks.filter((chunk) => chunk.startsWith("Advances:"))
        .length,
    ).toBeGreaterThan(1);
    for (const notation of Object.values(highMobility.moves).flat()) {
      const spoken = spokenMoveExample(notation);
      expect(occurrenceCount(first.fullText, spoken)).toBe(1);
      expect(occurrenceCount(tightlyChunked.fullText, spoken)).toBe(1);
    }

    expect(
      buildSpokenMoveOptions({
        total: 3,
        returned: 3,
        truncated: false,
        moves: {
          advance: ["a7-a6"],
          capture: ["e7xd6"],
          winning: ["b2-b1"],
        },
      }).fullText,
    ).toBe(
      "Black has 3 legal moves. Advances: a7 to a6. Captures: e7 takes d6. Winning moves: b2 to b1.",
    );

    expect(() =>
      buildSpokenMoveOptions({
        total: 2,
        returned: 1,
        truncated: true,
        moves: {
          advance: ["a7-a6"],
          capture: [],
          winning: [],
        },
      }),
    ).toThrow("The legal move list is incomplete; say options again.");
  });
});

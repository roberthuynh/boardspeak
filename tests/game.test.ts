import { describe, expect, it } from "vitest";
import { legalMoves } from "@/lib/breakthrough";
import {
  createEvalPosition,
  createSessionState,
  gameReducer,
  selectedMoves,
  sessionBoardPayload,
  type ToolTraceEntry,
} from "@/lib/game";

function move(state: ReturnType<typeof createSessionState>, notation: string) {
  const candidate = legalMoves(
    state.position,
    state.position.sideToMove,
  ).find((entry) => entry.notation === notation);

  if (!candidate) {
    throw new Error(`Missing test move ${notation}`);
  }

  return gameReducer(state, {
    type: "move",
    move: candidate,
    source: "mouse",
  });
}

describe("game session reducer", () => {
  it("selects a pawn and exposes only that pawn's legal targets", () => {
    const selected = gameReducer(createSessionState(), {
      type: "select",
      square: "e2",
    });

    expect(selectedMoves(selected).map((entry) => entry.notation)).toEqual([
      "e2-d3",
      "e2-e3",
      "e2-f3",
    ]);
    expect(selected.announcement).toBe(
      "White pawn e2 selected. Legal destinations: d3, e3, f3.",
    );

    const blocked = gameReducer(createSessionState(), {
      type: "select",
      square: "a1",
    });
    expect(blocked.announcement).toBe(
      "White pawn a1 selected. No legal destinations.",
    );

    const cleared = gameReducer(selected, { type: "select", square: null });
    expect(cleared.announcement).toBe("Selection cleared.");
    expect(cleared.selected).toBeNull();
    expect(cleared.suggestion).toBeNull();
    expect(cleared.revision).toBe(selected.revision + 1);
  });

  it("keeps the live announcement quiet for clean-board empty and opponent clicks", () => {
    const initial = createSessionState();
    const afterEmptySquare = gameReducer(initial, {
      type: "select",
      square: null,
    });
    const afterOpponentPawn = gameReducer(afterEmptySquare, {
      type: "select",
      square: null,
    });

    expect(afterEmptySquare).toBe(initial);
    expect(afterOpponentPawn).toBe(initial);
    expect(afterOpponentPawn.announcement).toBe("White to move.");
    expect(afterOpponentPawn.revision).toBe(0);
  });

  it("clears an agent suggestion silently when no pawn is selected", () => {
    const initial = createSessionState();
    const suggestion = legalMoves(initial.position, "white")[0];
    const suggested = gameReducer(initial, {
      type: "setSuggestion",
      move: suggestion,
    });
    const suggestionOnly = { ...suggested, selected: null };
    const cleared = gameReducer(suggestionOnly, {
      type: "select",
      square: null,
    });

    expect(cleared.suggestion).toBeNull();
    expect(cleared.selected).toBeNull();
    expect(cleared.announcement).toBe(suggestionOnly.announcement);
    expect(cleared.revision).toBe(suggestionOnly.revision + 1);
  });

  it("plays both colors by the same reducer path and records plain language", () => {
    const afterWhite = move(createSessionState(), "e2-e3");
    const afterBlack = move(afterWhite, "e7-e6");

    expect(afterWhite.position.sideToMove).toBe("black");
    expect(afterBlack.position.sideToMove).toBe("white");
    expect(afterBlack.history.map((entry) => entry.plainText)).toEqual([
      "White e2 moves to e3",
      "Black e7 moves to e6",
    ]);
    expect(afterBlack.registry.some((tool) => tool.name === "suggest_move")).toBe(
      true,
    );
  });

  it("draws a suggestion without moving and clears it after acceptance", () => {
    const initial = createSessionState();
    const suggestion = legalMoves(initial.position, "white")[0];
    const suggested = gameReducer(initial, {
      type: "setSuggestion",
      move: suggestion,
    });
    const accepted = gameReducer(suggested, {
      type: "move",
      move: suggestion,
      source: "mouse",
    });

    expect(suggested.position).toBe(initial.position);
    expect(suggested.suggestion?.notation).toBe(suggestion.notation);
    expect(accepted.suggestion).toBeNull();
    expect(accepted.position.lastMove?.notation).toBe(suggestion.notation);
  });

  it("preserves preferences and trace while resetting game progress", () => {
    let state = gameReducer(createSessionState(), {
      type: "setPractice",
      enabled: true,
    });
    state = gameReducer(state, { type: "setNarration", enabled: false });
    state = gameReducer(state, {
      type: "addTrace",
      entry: {
        id: "trace-1",
        timestamp: new Date(0).toISOString(),
        name: "describe_board",
        args: {},
        result: "ok",
        isError: false,
      },
    });
    state = move(state, "a2-a3");

    const reset = gameReducer(state, { type: "newGame" });

    expect(reset.preferences).toEqual({ practice: true, narrate: false });
    expect(reset.trace).toHaveLength(1);
    expect(reset.history).toHaveLength(0);
    expect(reset.position.sideToMove).toBe("white");
  });

  it("hides and restores the plain-browser setup copy", () => {
    const hidden = gameReducer(createSessionState(), {
      type: "setBannerDismissed",
      dismissed: true,
    });
    const restored = gameReducer(hidden, {
      type: "setBannerDismissed",
      dismissed: false,
    });

    expect(hidden.bannerDismissed).toBe(true);
    expect(restored.bannerDismissed).toBe(false);
  });

  it("overlays a session resignation onto board text and JSON", () => {
    const resigned = gameReducer(createSessionState(), {
      type: "resign",
      side: "black",
    });
    const payload = sessionBoardPayload(resigned);

    expect(payload.board).toContain("Winner: White (resignation).");
    expect(payload.snapshot.winner).toBe("white");
    expect(payload.outcome).toEqual({ winner: "white", reason: "resignation" });
  });

  it("keeps only the newest 50 trace entries", () => {
    let state = createSessionState();
    for (let index = 0; index < 55; index += 1) {
      const entry: ToolTraceEntry = {
        id: `trace-${index}`,
        timestamp: new Date(index).toISOString(),
        name: "describe_board",
        args: {},
        result: "ok",
        isError: false,
      };
      state = gameReducer(state, { type: "addTrace", entry });
    }

    expect(state.trace).toHaveLength(50);
    expect(state.trace[0]?.id).toBe("trace-54");
    expect(state.trace.at(-1)?.id).toBe("trace-5");
  });

  it("provides the deterministic eval position with advance and capture", () => {
    const position = createEvalPosition();
    expect(legalMoves(position, "black").map((entry) => entry.notation)).toContain(
      "e7-e6",
    );
    expect(legalMoves(position, "black").map((entry) => entry.notation)).toContain(
      "e7xd6",
    );
  });
});

import {
  applyMove,
  initialState,
  legalMoves,
  winner,
  type GameState,
  type Move,
  type Piece,
  type Side,
  type Square,
} from "./breakthrough";
import {
  buildToolRegistry,
  moveToPlainEnglish,
  type ToolRegistryEntry,
} from "./tools";

export type MoveSource = "mouse" | "agent" | "bot";
export type WinReason = "goal" | "annihilation" | "blocked" | "resignation";

export interface GameOutcome {
  readonly winner: Side;
  readonly reason: WinReason;
}

export interface GameHistoryEntry {
  readonly id: string;
  readonly notation: string;
  readonly plainText: string;
  readonly source: MoveSource;
}

export interface ToolTraceEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly name: string;
  readonly args: unknown;
  readonly result: string;
  readonly isError: boolean;
}

export interface GamePreferences {
  readonly practice: boolean;
  readonly narrate: boolean;
}

export interface SessionState {
  readonly position: GameState;
  readonly selected: Square | null;
  readonly suggestion: Move | null;
  readonly history: readonly GameHistoryEntry[];
  readonly outcome: GameOutcome | null;
  readonly preferences: GamePreferences;
  readonly trace: readonly ToolTraceEntry[];
  readonly registry: readonly ToolRegistryEntry[];
  readonly announcement: string;
  readonly bannerDismissed: boolean;
  readonly revision: number;
}

export type GameAction =
  | { readonly type: "select"; readonly square: Square | null }
  | { readonly type: "move"; readonly move: Move; readonly source: MoveSource }
  | { readonly type: "resign"; readonly side: Side }
  | { readonly type: "newGame"; readonly position?: GameState }
  | { readonly type: "setSuggestion"; readonly move: Move }
  | { readonly type: "clearSuggestion" }
  | { readonly type: "setPractice"; readonly enabled: boolean }
  | { readonly type: "setNarration"; readonly enabled: boolean }
  | { readonly type: "addTrace"; readonly entry: ToolTraceEntry }
  | { readonly type: "setBannerDismissed"; readonly dismissed: boolean };

function rank(square: Square): number {
  return Number(square[1]);
}

function winReason(state: GameState, winningSide: Side): WinReason {
  const goal = winningSide === "white" ? 8 : 1;

  if (
    state.pieces.some(
      (piece) => piece.side === winningSide && rank(piece.square) === goal,
    )
  ) {
    return "goal";
  }

  const losingSide = winningSide === "white" ? "black" : "white";
  if (!state.pieces.some((piece) => piece.side === losingSide)) {
    return "annihilation";
  }

  return "blocked";
}

function winnerSentence(outcome: GameOutcome): string {
  const side = outcome.winner === "white" ? "White" : "Black";
  const ending = {
    goal: "reaches the far rank",
    annihilation: "captures every opposing pawn",
    blocked: "leaves the opponent without a legal move",
    resignation: "wins by resignation",
  }[outcome.reason];

  return `${side} ${ending}. ${side} wins.`;
}

function withRegistry(state: Omit<SessionState, "registry">): SessionState {
  return {
    ...state,
    registry: buildToolRegistry(state.position, state.outcome?.winner ?? null),
  };
}

export function createEvalPosition(): GameState {
  const pieces: Piece[] = [
    { id: "black-e7", side: "black", square: "e7" },
    { id: "black-h8", side: "black", square: "h8" },
    { id: "white-d6", side: "white", square: "d6" },
    { id: "white-a1", side: "white", square: "a1" },
  ];

  return {
    pieces,
    sideToMove: "black",
    moveNumber: 2,
    lastMove: null,
    captured: { white: 14, black: 14 },
  };
}

export function createSessionState(position: GameState = initialState()): SessionState {
  return withRegistry({
    position,
    selected: null,
    suggestion: null,
    history: [],
    outcome: null,
    preferences: { practice: false, narrate: true },
    trace: [],
    announcement: `${position.sideToMove === "white" ? "White" : "Black"} to move.`,
    bannerDismissed: false,
    revision: 0,
  });
}

function nextRevision(state: SessionState): number {
  return state.revision + 1;
}

export function gameReducer(state: SessionState, action: GameAction): SessionState {
  switch (action.type) {
    case "select":
      return {
        ...state,
        selected: action.square,
        suggestion: action.square ? state.suggestion : null,
        revision: nextRevision(state),
      };

    case "move": {
      if (state.outcome) {
        throw new Error("The game is over; start a new game before moving.");
      }

      const position = applyMove(state.position, action.move);
      const winningSide = winner(position);
      const outcome = winningSide
        ? { winner: winningSide, reason: winReason(position, winningSide) }
        : null;
      const plainText = moveToPlainEnglish(position.lastMove ?? action.move);
      const announcement = outcome
        ? `${plainText}. ${winnerSentence(outcome)}`
        : `${plainText}. ${position.sideToMove === "white" ? "White" : "Black"} to move.`;

      return withRegistry({
        ...state,
        position,
        selected: null,
        suggestion: null,
        history: [
          ...state.history,
          {
            id: `${position.moveNumber}-${action.move.pieceId}-${action.move.notation}`,
            notation: action.move.notation,
            plainText,
            source: action.source,
          },
        ],
        outcome,
        announcement,
        revision: nextRevision(state),
      });
    }

    case "resign": {
      if (state.outcome) {
        throw new Error("The game is already over; start a new game to play again.");
      }

      const winningSide = action.side === "white" ? "black" : "white";
      const outcome: GameOutcome = {
        winner: winningSide,
        reason: "resignation",
      };

      return withRegistry({
        ...state,
        selected: null,
        suggestion: null,
        outcome,
        announcement: `${action.side === "white" ? "White" : "Black"} resigns. ${winnerSentence(outcome)}`,
        revision: nextRevision(state),
      });
    }

    case "newGame": {
      const position = action.position ?? initialState();
      return withRegistry({
        position,
        selected: null,
        suggestion: null,
        history: [],
        outcome: null,
        preferences: state.preferences,
        trace: state.trace,
        announcement: `New game. ${position.sideToMove === "white" ? "White" : "Black"} to move.`,
        bannerDismissed: state.bannerDismissed,
        revision: nextRevision(state),
      });
    }

    case "setSuggestion": {
      if (state.outcome || state.position.sideToMove !== "white") {
        throw new Error("A move can only be suggested while White is choosing.");
      }

      const legal = legalMoves(state.position, "white").some(
        (move) => move.notation === action.move.notation,
      );
      if (!legal) {
        throw new Error(`${action.move.notation} is not a legal White move now.`);
      }

      return {
        ...state,
        selected: action.move.from,
        suggestion: action.move,
        announcement: `Agent suggests ${action.move.notation}. Select ${action.move.to} to accept.`,
        revision: nextRevision(state),
      };
    }

    case "clearSuggestion":
      return {
        ...state,
        suggestion: null,
        announcement: "Move suggestion cleared.",
        revision: nextRevision(state),
      };

    case "setPractice":
      return {
        ...state,
        preferences: { ...state.preferences, practice: action.enabled },
        announcement: action.enabled
          ? "Practice mode on. The board will play White."
          : "Practice mode off. Both sides are available by mouse.",
        revision: nextRevision(state),
      };

    case "setNarration":
      return {
        ...state,
        preferences: { ...state.preferences, narrate: action.enabled },
        announcement: action.enabled ? "Move narration on." : "Move narration off.",
        revision: nextRevision(state),
      };

    case "addTrace":
      return {
        ...state,
        trace: [action.entry, ...state.trace].slice(0, 50),
        revision: nextRevision(state),
      };

    case "setBannerDismissed":
      return {
        ...state,
        bannerDismissed: action.dismissed,
        revision: nextRevision(state),
      };
  }
}

export function selectedMoves(state: SessionState): Move[] {
  if (!state.selected || state.outcome) {
    return [];
  }

  return legalMoves(state.position, state.position.sideToMove).filter(
    (move) => move.from === state.selected,
  );
}

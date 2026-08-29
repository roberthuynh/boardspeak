import {
  applyMove,
  legalMoves,
  threats,
  winner,
  type GameState,
  type Move,
  type Side,
} from "./breakthrough";

export type ToolName =
  | "describe_board"
  | "get_rules"
  | "list_legal_moves"
  | "play_move"
  | "play_capture"
  | "list_threats"
  | "suggest_move"
  | "resign_game"
  | "start_new_game";

export type ToolMode = "READ" | "ACT";

export interface ToolMeta {
  readonly name: ToolName;
  readonly mode: ToolMode;
  readonly description: string;
  readonly readOnlyHint: boolean;
}

export interface ToolRegistryEntry extends ToolMeta {
  readonly detail?: string;
}

export type MoveTag = "advance" | "capture" | "winning";

export const MAX_TOOL_OUTPUT_LENGTH = 1_500;

export interface TaggedMove {
  readonly move: string;
  readonly from: string;
  readonly to: string;
  readonly tag: MoveTag;
}

export interface GroupedMoveNotations {
  readonly advance: readonly string[];
  readonly capture: readonly string[];
  readonly winning: readonly string[];
}

export interface LegalMoveListOutput {
  readonly turn: Side;
  readonly canPlayNow: boolean;
  readonly total: number;
  readonly returned: number;
  readonly truncated: boolean;
  readonly moves: GroupedMoveNotations;
}

export const TOOL_META: Readonly<Record<ToolName, ToolMeta>> = {
  describe_board: {
    name: "describe_board",
    mode: "READ",
    readOnlyHint: true,
    description:
      "Describe the live board in compact text and structured JSON. Returns every piece square, the side to move, move number, last move, captures, and winner so you can understand or verify the current position.",
  },
  get_rules: {
    name: "get_rules",
    mode: "READ",
    readOnlyHint: true,
    description:
      "Read the four rules of Breakthrough and its move notation. Returns the movement, capture, and win rules plus the differences from chess pawns and checkers pieces.",
  },
  list_legal_moves: {
    name: "list_legal_moves",
    mode: "READ",
    readOnlyHint: true,
    description:
      "List Black's legal moves in the live position. Returns bare move notations grouped as advance, capture, or winning, plus totals, truncation status, and whether Black can play now.",
  },
  play_move: {
    name: "play_move",
    mode: "ACT",
    readOnlyHint: false,
    description:
      "Play one of Black's currently legal moves. Only the listed values are accepted. The board updates immediately and the turn passes to White. Returns the move result, White replies, and updated board.",
  },
  play_capture: {
    name: "play_capture",
    mode: "ACT",
    readOnlyHint: false,
    description:
      "Take a White pawn with one of Black's available captures. Choose this shortcut when the player asks to capture. Returns the capture result, White replies, and updated board.",
  },
  list_threats: {
    name: "list_threats",
    mode: "READ",
    readOnlyHint: true,
    description:
      "List pawns that are one forward step from their winning rank. Returns each threatening square, side, and goal rank so you can respond to an immediate race threat.",
  },
  suggest_move: {
    name: "suggest_move",
    mode: "ACT",
    readOnlyHint: false,
    description:
      "Suggest one currently legal White move to the mouse player. Draws a ghost arrow without moving a pawn and returns the visible suggestion for the player to accept or ignore.",
  },
  resign_game: {
    name: "resign_game",
    mode: "ACT",
    readOnlyHint: false,
    description:
      "Offer Black's resignation for in-page player confirmation. Returns whether the player confirmed or cancelled and leaves the board unchanged when cancelled.",
  },
  start_new_game: {
    name: "start_new_game",
    mode: "ACT",
    readOnlyHint: false,
    description:
      "Start a fresh Breakthrough game. Requests in-page confirmation when the current game is still live, then returns the reset board or a cancellation result.",
  },
} as const;

export const EMPTY_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

export function moveInputSchema(moves: readonly Move[]) {
  return {
    type: "object",
    properties: {
      move: {
        type: "string",
        enum: moves.map((move) => move.notation),
        description:
          "Exact move notation from this turn's legal values, such as e7-e6 or e7xd6.",
      },
    },
    required: ["move"],
    additionalProperties: false,
  } as const;
}

export const RULES = [
  "Move one pawn one square forward, straight or diagonally, into an empty square.",
  "Capture only by moving one square diagonally forward onto an enemy pawn; capturing is optional.",
  "Win by reaching the far rank, capturing every enemy pawn, or leaving the opponent with no legal move.",
  "There are no two-square moves, en passant, promotion, jumps, chains, backward moves, sideways moves, checks, or forced captures.",
] as const;

export const NOTATION = {
  move: "e5-e4",
  capture: "e5xd4",
} as const;

export function classifyMove(state: GameState, move: Move): MoveTag {
  const analysisState =
    state.sideToMove === move.side ? state : { ...state, sideToMove: move.side };

  if (winner(applyMove(analysisState, move)) === move.side) {
    return "winning";
  }

  return move.capture ? "capture" : "advance";
}

export function tagMoves(state: GameState, moves: readonly Move[]): TaggedMove[] {
  return moves.map((move) => ({
    move: move.notation,
    from: move.from,
    to: move.to,
    tag: classifyMove(state, move),
  }));
}

export function getBlackMoves(state: GameState, gameOver = Boolean(winner(state))): Move[] {
  return gameOver ? [] : legalMoves(state, "black");
}

export function getWhiteMoves(state: GameState, gameOver = Boolean(winner(state))): Move[] {
  return gameOver ? [] : legalMoves(state, "white");
}

export function buildToolRegistry(
  state: GameState,
  sessionWinner: Side | null,
): ToolRegistryEntry[] {
  const gameOver = Boolean(sessionWinner ?? winner(state));
  const blackMoves = getBlackMoves(state, gameOver);
  const captures = blackMoves.filter((move) => move.capture);
  const whiteMoves = getWhiteMoves(state, gameOver);
  const positionThreats = threats(state);
  const registry: ToolRegistryEntry[] = [
    TOOL_META.describe_board,
    TOOL_META.get_rules,
    {
      ...TOOL_META.list_legal_moves,
      detail: `${blackMoves.length} ${blackMoves.length === 1 ? "option" : "options"}`,
    },
  ];

  if (!gameOver && state.sideToMove === "black") {
    registry.push({
      ...TOOL_META.play_move,
      detail: `${blackMoves.length} legal`,
    });

    if (captures.length > 0) {
      registry.push({
        ...TOOL_META.play_capture,
        detail: `${captures.length} ${captures.length === 1 ? "capture" : "captures"}`,
      });
    }
  }

  if (!gameOver && positionThreats.length > 0) {
    registry.push({
      ...TOOL_META.list_threats,
      detail: `${positionThreats.length} ${positionThreats.length === 1 ? "threat" : "threats"}`,
    });
  }

  if (!gameOver && state.sideToMove === "white") {
    registry.push({
      ...TOOL_META.suggest_move,
      detail: `${whiteMoves.length} legal`,
    });
  }

  if (!gameOver) {
    registry.push(TOOL_META.resign_game);
  }

  registry.push(TOOL_META.start_new_game);
  return registry;
}

export function moveToPlainEnglish(move: Move): string {
  const side = move.side === "white" ? "White" : "Black";
  return move.capture
    ? `${side} ${move.from} takes ${move.to}`
    : `${side} ${move.from} moves to ${move.to}`;
}

export function assertObjectArgs(value: unknown, tool: ToolName): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${tool} expects a JSON object of arguments.`);
  }

  return value as Record<string, unknown>;
}

export function moveArg(value: unknown, allowed: readonly Move[], tool: ToolName): Move {
  const args = assertObjectArgs(value, tool);
  const move = typeof args.move === "string" ? args.move : "";
  const extraKeys = Object.keys(args).filter((key) => key !== "move");
  const retry =
    tool === "suggest_move"
      ? "retry with only move set to one value from suggest_move's current move enum"
      : "call list_legal_moves and retry with only move set to one listed value";

  if (extraKeys.length > 0) {
    throw new Error(
      `${tool} received an unknown parameter (${extraKeys.join(", ")}); ${retry}.`,
    );
  }

  const match = allowed.find((candidate) => candidate.notation === move);
  if (!match) {
    throw new Error(
      `${move || "That move"} is not legal now; ${retry}.`,
    );
  }

  return match;
}

function normalizedToolOutput(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "content" in value &&
    Array.isArray((value as { readonly content?: unknown }).content)
  ) {
    return value;
  }

  if (value === undefined || value === null) {
    return { content: [] };
  }

  if (typeof value === "string") {
    return { content: [{ type: "text", text: value }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function toolOutputLength(value: unknown): number {
  return JSON.stringify(normalizedToolOutput(value)).length;
}

export function compactLegalMoves(
  turn: Side,
  canPlayNow: boolean,
  taggedMoves: readonly Pick<TaggedMove, "move" | "tag">[],
  maxOutputLength = MAX_TOOL_OUTPUT_LENGTH,
): LegalMoveListOutput {
  const grouped: Record<MoveTag, string[]> = {
    advance: [],
    capture: [],
    winning: [],
  };
  const total = taggedMoves.length;
  let returned = 0;

  const result = (): LegalMoveListOutput => ({
    turn,
    canPlayNow,
    total,
    returned,
    truncated: returned < total,
    moves: grouped,
  });

  for (const taggedMove of taggedMoves) {
    grouped[taggedMove.tag].push(taggedMove.move);
    returned += 1;

    if (toolOutputLength(result()) > maxOutputLength) {
      grouped[taggedMove.tag].pop();
      returned -= 1;
      break;
    }
  }

  return result();
}

export function shouldExposeBoardspeakTestApi(
  environment: string | undefined,
  evalMode: boolean,
): boolean {
  return environment !== "production" || evalMode;
}

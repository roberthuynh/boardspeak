export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type Side = "white" | "black";
export type File = (typeof FILES)[number];
export type Rank = (typeof RANKS)[number];
export type Square = `${File}${Rank}`;

export interface Piece {
  readonly id: string;
  readonly side: Side;
  readonly square: Square;
}

export interface Move {
  readonly pieceId: string;
  readonly side: Side;
  readonly from: Square;
  readonly to: Square;
  readonly notation: string;
  readonly capture: boolean;
  readonly capturedPieceId: string | null;
}

export interface GameState {
  readonly pieces: readonly Piece[];
  readonly sideToMove: Side;
  /** One-based ply number. It advances after every move. */
  readonly moveNumber: number;
  readonly lastMove: Move | null;
  /** Number of pieces of each color that have been captured. */
  readonly captured: Readonly<Record<Side, number>>;
}

export interface Threat {
  readonly pieceId: string;
  readonly side: Side;
  readonly square: Square;
  readonly goalRank: 1 | 8;
}

export interface GameSnapshot {
  readonly pieces: Readonly<Record<Side, readonly Square[]>>;
  readonly sideToMove: Side;
  readonly moveNumber: number;
  readonly lastMove: {
    readonly notation: string;
    readonly side: Side;
    readonly from: Square;
    readonly to: Square;
    readonly capture: boolean;
  } | null;
  readonly captured: Readonly<Record<Side, number>>;
  readonly winner: Side | null;
}

const INITIAL_PIECES_PER_SIDE = 16;

function opposite(side: Side): Side {
  return side === "white" ? "black" : "white";
}

function squareAt(fileIndex: number, rank: number): Square | null {
  const file = FILES[fileIndex];

  if (!file || rank < 1 || rank > 8) {
    return null;
  }

  return `${file}${rank}` as Square;
}

function squareParts(square: Square): { fileIndex: number; rank: number } {
  return {
    fileIndex: FILES.indexOf(square[0] as File),
    rank: Number(square[1]),
  };
}

function compareSquares(left: Square, right: Square): number {
  const leftParts = squareParts(left);
  const rightParts = squareParts(right);

  return (
    leftParts.fileIndex - rightParts.fileIndex || leftParts.rank - rightParts.rank
  );
}

function compareMoves(left: Move, right: Move): number {
  return compareSquares(left.from, right.from) || compareSquares(left.to, right.to);
}

function sortedSquares(state: GameState, side: Side): Square[] {
  return state.pieces
    .filter((piece) => piece.side === side)
    .map((piece) => piece.square)
    .sort(compareSquares);
}

export function initialState(): GameState {
  const pieces: Piece[] = [];

  for (const file of FILES) {
    for (const rank of [1, 2] as const) {
      const square = `${file}${rank}` as Square;
      pieces.push({ id: `white-${square}`, side: "white", square });
    }
  }

  for (const file of FILES) {
    for (const rank of [7, 8] as const) {
      const square = `${file}${rank}` as Square;
      pieces.push({ id: `black-${square}`, side: "black", square });
    }
  }

  return {
    pieces,
    sideToMove: "white",
    moveNumber: 1,
    lastMove: null,
    captured: { white: 0, black: 0 },
  };
}

/**
 * Returns every geometrically legal move for a side in deterministic
 * source-then-destination order. Turn enforcement belongs to applyMove.
 */
export function legalMoves(state: GameState, side: Side): Move[] {
  const occupied = new Map(state.pieces.map((piece) => [piece.square, piece]));
  const direction = side === "white" ? 1 : -1;
  const moves: Move[] = [];

  for (const piece of state.pieces) {
    if (piece.side !== side) {
      continue;
    }

    const { fileIndex, rank } = squareParts(piece.square);
    const destinationRank = rank + direction;

    for (const fileDelta of [-1, 0, 1] as const) {
      const destination = squareAt(fileIndex + fileDelta, destinationRank);

      if (!destination) {
        continue;
      }

      const occupant = occupied.get(destination);

      if (fileDelta === 0) {
        if (occupant) {
          continue;
        }
      } else if (occupant?.side === side) {
        continue;
      }

      const isCapture = fileDelta !== 0 && occupant?.side === opposite(side);

      moves.push({
        pieceId: piece.id,
        side,
        from: piece.square,
        to: destination,
        notation: `${piece.square}${isCapture ? "x" : "-"}${destination}`,
        capture: isCapture,
        capturedPieceId: isCapture ? (occupant?.id ?? null) : null,
      });
    }
  }

  return moves.sort(compareMoves);
}

export function winner(state: GameState): Side | null {
  const whitePieces = state.pieces.filter((piece) => piece.side === "white");
  const blackPieces = state.pieces.filter((piece) => piece.side === "black");

  if (whitePieces.some((piece) => squareParts(piece.square).rank === 8)) {
    return "white";
  }

  if (blackPieces.some((piece) => squareParts(piece.square).rank === 1)) {
    return "black";
  }

  if (whitePieces.length === 0) {
    return "black";
  }

  if (blackPieces.length === 0) {
    return "white";
  }

  if (legalMoves(state, state.sideToMove).length === 0) {
    return opposite(state.sideToMove);
  }

  return null;
}

export function applyMove(state: GameState, requestedMove: Move | string): GameState {
  if (winner(state)) {
    throw new Error("The game is over; start a new game before playing another move.");
  }

  const requestedNotation =
    typeof requestedMove === "string" ? requestedMove : requestedMove.notation;
  const move = legalMoves(state, state.sideToMove).find(
    (candidate) => candidate.notation === requestedNotation,
  );

  if (!move) {
    throw new Error(
      `${requestedNotation || "That move"} is not legal for ${state.sideToMove} now.`,
    );
  }

  const movedPieces = state.pieces
    .filter((piece) => piece.id !== move.capturedPieceId)
    .map((piece) =>
      piece.id === move.pieceId ? { ...piece, square: move.to } : piece,
    );
  const capturedSide = move.capture ? opposite(move.side) : null;

  return {
    pieces: movedPieces,
    sideToMove: opposite(state.sideToMove),
    moveNumber: state.moveNumber + 1,
    lastMove: move,
    captured: capturedSide
      ? {
          ...state.captured,
          [capturedSide]: state.captured[capturedSide] + 1,
        }
      : state.captured,
  };
}

export function threats(state: GameState): Threat[] {
  return state.pieces
    .filter((piece) => {
      const rank = squareParts(piece.square).rank;
      return piece.side === "white" ? rank === 7 : rank === 2;
    })
    .map((piece) => ({
      pieceId: piece.id,
      side: piece.side,
      square: piece.square,
      goalRank: piece.side === "white" ? (8 as const) : (1 as const),
    }))
    .sort((left, right) => compareSquares(left.square, right.square));
}

export function toJSON(state: GameState): GameSnapshot {
  return {
    pieces: {
      white: sortedSquares(state, "white"),
      black: sortedSquares(state, "black"),
    },
    sideToMove: state.sideToMove,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove
      ? {
          notation: state.lastMove.notation,
          side: state.lastMove.side,
          from: state.lastMove.from,
          to: state.lastMove.to,
          capture: state.lastMove.capture,
        }
      : null,
    captured: {
      white: state.captured.white,
      black: state.captured.black,
    },
    winner: winner(state),
  };
}

export function toText(state: GameState): string {
  const snapshot = toJSON(state);
  const whiteSquares = snapshot.pieces.white.join(", ") || "none";
  const blackSquares = snapshot.pieces.black.join(", ") || "none";
  const winningSide = snapshot.winner
    ? `${snapshot.winner[0].toUpperCase()}${snapshot.winner.slice(1)}`
    : "none";

  return [
    `White (${INITIAL_PIECES_PER_SIDE - snapshot.captured.white}): ${whiteSquares}.`,
    `Black (${INITIAL_PIECES_PER_SIDE - snapshot.captured.black}): ${blackSquares}.`,
    `Side to move: ${snapshot.sideToMove}. Move number: ${snapshot.moveNumber}.`,
    `Last move: ${snapshot.lastMove?.notation ?? "none"}.`,
    `Captured: white ${snapshot.captured.white}, black ${snapshot.captured.black}. Winner: ${winningSide}.`,
  ].join("\n");
}

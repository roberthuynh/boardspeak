import {
  applyMove,
  legalMoves,
  winner,
  type GameState,
  type Move,
} from "./breakthrough";

function destinationRank(move: Move): number {
  return Number(move.to[1]);
}

/**
 * Chooses a deterministic one-ply move for White: win, capture, advance the
 * furthest pawn, then use notation as the stable tie-breaker.
 */
export function chooseBotMove(state: GameState): Move | null {
  if (state.sideToMove !== "white" || winner(state)) {
    return null;
  }

  const candidates = legalMoves(state, "white");

  candidates.sort((left, right) => {
    const leftWins = winner(applyMove(state, left)) === "white" ? 1 : 0;
    const rightWins = winner(applyMove(state, right)) === "white" ? 1 : 0;

    return (
      rightWins - leftWins ||
      Number(right.capture) - Number(left.capture) ||
      destinationRank(right) - destinationRank(left) ||
      left.notation.localeCompare(right.notation)
    );
  });

  return candidates[0] ?? null;
}

export const chooseWhiteMove = chooseBotMove;

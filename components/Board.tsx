"use client";

import type { CSSProperties } from "react";

import type { GameState, Move, Side, Square } from "@/lib/breakthrough";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;

interface BoardProps {
  state: GameState;
  legalTargets: readonly Square[];
  selected: Square | null;
  suggestion: Move | null;
  onSquareClick: (square: Square) => void;
  disabled?: boolean;
}

interface PiecePositionStyle extends CSSProperties {
  "--board-file": number;
  "--board-rank": number;
}

function squarePosition(square: Square) {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = Number(square[1]);

  return {
    file,
    row: 8 - rank,
  };
}

function piecePositionStyle(square: Square): PiecePositionStyle {
  const position = squarePosition(square);
  return {
    "--board-file": position.file,
    "--board-rank": position.row,
  };
}

function WhitePawn() {
  return (
    <svg aria-hidden="true" className="pawn-svg" viewBox="0 0 64 64">
      <circle cx="32" cy="18" r="11" fill="#fff8e9" stroke="#29241f" strokeWidth="4" />
      <path
        d="M20 51c1-9 4-16 9-21h6c5 5 8 12 9 21H20Z"
        fill="#fff8e9"
        stroke="#29241f"
        strokeLinejoin="round"
        strokeWidth="4"
      />
      <path
        d="M16 51h32c3 0 5 2 5 5H11c0-3 2-5 5-5Z"
        fill="#fff8e9"
        stroke="#29241f"
        strokeLinejoin="round"
        strokeWidth="4"
      />
    </svg>
  );
}

function BlackPawn() {
  return (
    <svg aria-hidden="true" className="pawn-svg" viewBox="0 0 64 64">
      <circle cx="32" cy="18" r="11" fill="#211d1a" stroke="#fff1d0" strokeWidth="4" />
      <path
        d="M20 51c1-9 4-16 9-21h6c5 5 8 12 9 21H20Z"
        fill="#211d1a"
        stroke="#fff1d0"
        strokeLinejoin="round"
        strokeWidth="4"
      />
      <path
        d="M16 51h32c3 0 5 2 5 5H11c0-3 2-5 5-5Z"
        fill="#211d1a"
        stroke="#fff1d0"
        strokeLinejoin="round"
        strokeWidth="4"
      />
    </svg>
  );
}

function Pawn({ side }: { side: Side }) {
  return side === "white" ? <WhitePawn /> : <BlackPawn />;
}

function SuggestionArrow({ move }: { move: Move }) {
  const from = squarePosition(move.from);
  const to = squarePosition(move.to);
  const startX = from.file * 100 + 50;
  const startY = from.row * 100 + 50;
  const endX = to.file * 100 + 50;
  const endY = to.row * 100 + 50;

  return (
    <svg
      aria-hidden="true"
      className="suggestion-arrow"
      data-from={move.from}
      data-to={move.to}
      viewBox="0 0 800 800"
    >
      <defs>
        <marker
          id="suggestion-arrowhead"
          markerHeight="8"
          markerWidth="8"
          orient="auto-start-reverse"
          refX="6"
          refY="4"
          viewBox="0 0 8 8"
        >
          <path d="M0 0 8 4 0 8Z" />
        </marker>
      </defs>
      <path
        d={`M ${startX} ${startY} L ${endX} ${endY}`}
        markerEnd="url(#suggestion-arrowhead)"
      />
      <circle cx={startX} cy={startY} r="10" />
    </svg>
  );
}

export function Board({
  state,
  legalTargets,
  selected,
  suggestion,
  onSquareClick,
  disabled = false,
}: BoardProps) {
  const piecesBySquare = new Map(state.pieces.map((piece) => [piece.square, piece]));
  const legalTargetSet = new Set(legalTargets);
  const capturedPiece = state.lastMove?.capture
    ? {
        id: state.lastMove.capturedPieceId,
        side: state.lastMove.side === "white" ? ("black" as const) : ("white" as const),
        square: state.lastMove.to,
      }
    : null;

  return (
    <div className="board-frame">
      <div
        aria-label="Breakthrough game board"
        className="board"
        data-turn={state.sideToMove}
        role="group"
      >
        <div className="board-squares">
          {RANKS.flatMap((rank) =>
            FILES.map((file) => {
              const square = `${file}${rank}` as Square;
              const piece = piecesBySquare.get(square);
              const isLegalTarget = legalTargetSet.has(square);
              const isSelected = selected === square;

              return (
                <button
                  aria-label={`${square}, ${piece ? `${piece.side} pawn` : "empty"}`}
                  aria-pressed={isSelected}
                  className="board-square"
                  data-file={file}
                  data-legal-target={isLegalTarget ? "true" : undefined}
                  data-occupied={piece?.side}
                  data-rank={rank}
                  data-selected={isSelected ? "true" : undefined}
                  data-square={square}
                  data-tone={(FILES.indexOf(file) + rank) % 2 === 0 ? "light" : "dark"}
                  disabled={disabled}
                  key={square}
                  onClick={() => onSquareClick(square)}
                  type="button"
                >
                  {file === "a" ? (
                    <span aria-hidden="true" className="rank-coordinate">
                      {rank}
                    </span>
                  ) : null}
                  {rank === 1 ? (
                    <span aria-hidden="true" className="file-coordinate">
                      {file}
                    </span>
                  ) : null}
                  {isLegalTarget ? <span className="legal-target-dot" aria-hidden="true" /> : null}
                </button>
              );
            }),
          )}
        </div>

        <div aria-hidden="true" className="piece-layer">
          {state.pieces.map((piece) => {
            return (
              <span
                className="board-piece"
                data-piece-id={piece.id}
                data-side={piece.side}
                data-square={piece.square}
                key={piece.id}
                style={piecePositionStyle(piece.square)}
              >
                <Pawn side={piece.side} />
              </span>
            );
          })}
          {capturedPiece?.id ? (
            <span
              className="board-piece captured-piece"
              data-piece-id={capturedPiece.id}
              data-side={capturedPiece.side}
              data-square={capturedPiece.square}
              key={`captured-${state.moveNumber}-${capturedPiece.id}`}
              style={piecePositionStyle(capturedPiece.square)}
            >
              <Pawn side={capturedPiece.side} />
            </span>
          ) : null}
        </div>

        {suggestion ? <SuggestionArrow move={suggestion} /> : null}
      </div>
    </div>
  );
}

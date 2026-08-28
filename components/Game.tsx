"use client";

import { useCallback, useMemo, useReducer, useRef } from "react";
import { Board } from "./Board";
import { MoveLog } from "./MoveLog";
import { legalMoves, type Move, type Square } from "@/lib/breakthrough";
import {
  createSessionState,
  gameReducer,
  selectedMoves,
  type GameOutcome,
} from "@/lib/game";

function winnerText(outcome: GameOutcome | null): string | null {
  if (!outcome) {
    return null;
  }

  const side = outcome.winner === "white" ? "White" : "Black";
  const explanation = {
    goal: "reached the far rank",
    annihilation: "captured every opposing pawn",
    blocked: "left the opponent without a legal move",
    resignation: "won by resignation",
  }[outcome.reason];

  return `${side} wins: ${explanation}.`;
}

export function Game() {
  const [state, dispatch] = useReducer(
    gameReducer,
    undefined,
    () => createSessionState(),
  );
  const movePendingRef = useRef(false);
  const movesFromSelection = useMemo(() => selectedMoves(state), [state]);
  const legalTargets = useMemo(
    () => movesFromSelection.map((move) => move.to),
    [movesFromSelection],
  );

  const playMove = useCallback((move: Move) => {
    if (movePendingRef.current) {
      return;
    }
    movePendingRef.current = true;
    dispatch({ type: "move", move, source: "mouse" });
    window.requestAnimationFrame(() => {
      movePendingRef.current = false;
    });
  }, []);

  const onSquareClick = useCallback(
    (square: Square) => {
      if (state.outcome) {
        return;
      }

      const matchingMove = movesFromSelection.find((move) => move.to === square);
      if (matchingMove) {
        playMove(matchingMove);
        return;
      }

      if (state.selected === square) {
        dispatch({ type: "select", square: null });
        return;
      }

      const piece = state.position.pieces.find(
        (candidate) => candidate.square === square,
      );
      dispatch({
        type: "select",
        square: piece?.side === state.position.sideToMove ? square : null,
      });
    },
    [movesFromSelection, playMove, state.outcome, state.position, state.selected],
  );

  const turn = state.position.sideToMove;
  const gameWinner = winnerText(state.outcome);
  const currentMoves = state.outcome ? [] : legalMoves(state.position, turn);

  return (
    <div className="game-shell">
      <a className="skip-link" href="#game-board">
        Skip to board
      </a>

      <header className="game-header">
        <div className="brand-lockup">
          <p className="brand-kicker">Open-source WebMCP game</p>
          <h1>Boardspeak</h1>
          <p className="tagline">Play it by hand. Play it by voice.</p>
        </div>

        <p className="loop-explainer">
          Two players share one live board. Select a pawn, then a marked square.
        </p>

        <div className="game-controls" aria-label="Game controls">
          <button
            className="new-game-button"
            onClick={() => dispatch({ type: "newGame" })}
            type="button"
          >
            New game
          </button>
          {!state.outcome ? (
            <button
              className="quiet-action"
              onClick={() => dispatch({ type: "resign", side: turn })}
              type="button"
            >
              Resign {turn === "white" ? "White" : "Black"}
            </button>
          ) : null}
        </div>
      </header>

      <main className="game-layout" id="main-content">
        <section
          className="board-stage"
          id="game-board"
          aria-labelledby="board-heading"
          tabIndex={-1}
        >
          <div className="turn-bar">
            <div>
              <p className="panel-kicker">
                Move {Math.ceil(state.position.moveNumber / 2)}
              </p>
              <h2 id="board-heading">
                {state.outcome
                  ? `${state.outcome.winner === "white" ? "White" : "Black"} wins`
                  : `${turn === "white" ? "White" : "Black"} to move`}
              </h2>
            </div>
            <span className="turn-chip" data-side={turn}>
              {currentMoves.length} legal
            </span>
          </div>

          {gameWinner ? <p className="board-verdict">{gameWinner}</p> : null}

          <Board
            disabled={Boolean(state.outcome)}
            legalTargets={legalTargets}
            onSquareClick={onSquareClick}
            selected={state.selected}
            state={state.position}
            suggestion={null}
          />

          <div className="board-caption">
            <p>
              Move one square forward, straight or diagonally. Capture only
              diagonally; captures are optional.
            </p>
          </div>

          <MoveLog entries={state.history} winnerText={gameWinner} />
        </section>

        <aside className="agent-column rules-panel" aria-labelledby="rules-heading">
          <p className="panel-kicker">Breakthrough, not chess</p>
          <h2 id="rules-heading">Reach the far rank first.</h2>
          <ol className="rules-list">
            <li>White travels toward rank 8. Black travels toward rank 1.</li>
            <li>Move straight or diagonally into an empty square.</li>
            <li>Capture diagonally only. Taking is never forced.</li>
            <li>Reach the goal, clear the opponent, or leave no legal move.</li>
          </ol>
          <p className="rules-note">
            No double steps, jumps, promotions, chains, or backward moves.
          </p>
        </aside>
      </main>

      <footer className="game-footer">
        <span>One tab. One board. One shared truth.</span>
        <a href="https://github.com/roberthuynh/boardspeak">Source on GitHub</a>
      </footer>
    </div>
  );
}

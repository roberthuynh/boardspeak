"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { AgentBanner } from "./AgentBanner";
import { Board } from "./Board";
import { CallTrace } from "./CallTrace";
import { ConfirmProvider, useConfirm } from "./ConfirmModal";
import { MoveLog } from "./MoveLog";
import { ToolRail } from "./ToolRail";
import { WebMCPBridge, type ToolExecutor } from "./WebMCPBridge";
import { chooseWhiteMove } from "@/lib/bot";
import {
  legalMoves,
  threats,
  winner,
  type Move,
  type Square,
} from "@/lib/breakthrough";
import {
  createEvalPosition,
  createSessionState,
  gameReducer,
  selectedMoves,
  sessionBoardPayload,
  type GameAction,
  type GameOutcome,
  type SessionState,
  type ToolTraceEntry,
} from "@/lib/game";
import { createNarrator } from "@/lib/narration";
import {
  MAX_TOOL_OUTPUT_LENGTH,
  NOTATION,
  RULES,
  assertObjectArgs,
  compactLegalMoves,
  moveArg,
  shouldExposeBoardspeakTestApi,
  tagMoves,
  toolOutputLength,
  type ToolName,
} from "@/lib/tools";

const EVAL_MODE = process.env.NEXT_PUBLIC_EVAL_MODE === "1";
const EXPOSE_TEST_API = shouldExposeBoardspeakTestApi(
  process.env.NODE_ENV,
  EVAL_MODE,
);

interface CommitWaiter {
  readonly revision: number;
  readonly resolve: (state: SessionState) => void;
}

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

function narrationWinText(outcome: GameOutcome): string {
  const side = outcome.winner === "white" ? "White" : "Black";

  switch (outcome.reason) {
    case "goal":
      return `${side} wins by reaching the far rank.`;
    case "annihilation":
      return `${side} wins by capturing every opposing pawn.`;
    case "blocked": {
      const loser = outcome.winner === "white" ? "Black" : "White";
      return `${side} wins because ${loser} has no legal moves.`;
    }
    case "resignation": {
      const loser = outcome.winner === "white" ? "Black" : "White";
      return `${loser} resigns. ${side} wins.`;
    }
  }
}

function traceSummary(value: unknown): string {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return serialized.length > 620 ? `${serialized.slice(0, 619)}…` : serialized;
}

function requireNoArgs(value: unknown, tool: ToolName): void {
  const args = assertObjectArgs(value ?? {}, tool);
  const keys = Object.keys(args);
  if (keys.length > 0) {
    throw new Error(`${tool} does not accept parameters; retry with an empty object.`);
  }
}

function assertToolOutput(name: ToolName, result: unknown): void {
  if (toolOutputLength(result) > MAX_TOOL_OUTPUT_LENGTH) {
    throw new Error(`${name} could not return a compact result; retry after the board changes.`);
  }
}

function GameInner() {
  const confirm = useConfirm();
  const [state, dispatch] = useReducer(
    gameReducer,
    undefined,
    () => createSessionState(EVAL_MODE ? createEvalPosition() : undefined),
  );
  const stateRef = useRef(state);
  const waitersRef = useRef<CommitWaiter[]>([]);
  const toolQueueRef = useRef<Promise<void>>(Promise.resolve());
  const traceIdRef = useRef(0);
  const mouseMovePendingRef = useRef(false);
  const [nativeSupported, setNativeSupported] = useState<boolean | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  const [narrator] = useState(() => createNarrator());
  const lastNarratedMoveRef = useRef<string | null>(null);
  const lastNarratedOutcomeRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const ready = waitersRef.current.filter(
      (waiter) => waiter.revision <= state.revision,
    );
    waitersRef.current = waitersRef.current.filter(
      (waiter) => waiter.revision > state.revision,
    );
    for (const waiter of ready) {
      waiter.resolve(state);
    }
  }, [state]);

  useEffect(() => {
    setShowDemo(new URLSearchParams(window.location.search).get("demo") === "1");
    return () => {
      for (const waiter of waitersRef.current) {
        waiter.resolve(stateRef.current);
      }
      waitersRef.current = [];
      narrator.cancel();
    };
  }, [narrator]);

  const dispatchAndCommit = useCallback(
    (action: GameAction): Promise<SessionState> => {
      const targetRevision = stateRef.current.revision + 1;
      return new Promise((resolve) => {
        waitersRef.current.push({ revision: targetRevision, resolve });
        dispatch(action);
      });
    },
    [],
  );

  const appendTrace = useCallback(
    async (
      name: ToolName,
      args: unknown,
      result: unknown,
      isError: boolean,
    ) => {
      const entry: ToolTraceEntry = {
        id: `trace-${Date.now()}-${traceIdRef.current++}`,
        timestamp: new Date().toISOString(),
        name,
        args: args ?? {},
        result: traceSummary(result),
        isError,
      };
      await dispatchAndCommit({ type: "addTrace", entry });
    },
    [dispatchAndCommit],
  );

  const executeToolCore = useCallback(
    async (name: ToolName, rawArgs: unknown, signal?: AbortSignal) => {
      const current = stateRef.current;
      const gameOver = Boolean(current.outcome ?? winner(current.position));

      switch (name) {
        case "describe_board":
          requireNoArgs(rawArgs, name);
          return sessionBoardPayload(current);

        case "get_rules":
          requireNoArgs(rawArgs, name);
          return { rules: RULES, notation: NOTATION };

        case "list_legal_moves": {
          requireNoArgs(rawArgs, name);
          const moves = gameOver ? [] : legalMoves(current.position, "black");
          return compactLegalMoves(
            current.position.sideToMove,
            !gameOver && current.position.sideToMove === "black",
            tagMoves(current.position, moves),
          );
        }

        case "play_move": {
          if (gameOver) {
            throw new Error("The game is over; call start_new_game before playing.");
          }
          if (current.position.sideToMove !== "black") {
            throw new Error(
              "It is White's turn; wait for White to move, then call list_legal_moves and retry.",
            );
          }

          const allowed = legalMoves(current.position, "black");
          const move = moveArg(rawArgs, allowed, name);
          const updated = await dispatchAndCommit({
            type: "move",
            move,
            source: "agent",
          });
          const whiteReplies = updated.outcome
            ? []
            : legalMoves(updated.position, "white").map((reply) => reply.notation);
          return {
            played: move.notation,
            capture: move.capture,
            winner: updated.outcome?.winner ?? null,
            whiteReplies,
            board: sessionBoardPayload(updated).board,
          };
        }

        case "play_capture": {
          if (gameOver) {
            throw new Error("The game is over; call start_new_game before capturing.");
          }
          if (current.position.sideToMove !== "black") {
            throw new Error(
              "It is White's turn; wait for White to move, then call list_legal_moves and retry.",
            );
          }

          const captures = legalMoves(current.position, "black").filter(
            (move) => move.capture,
          );
          const move = moveArg(rawArgs, captures, name);
          const updated = await dispatchAndCommit({
            type: "move",
            move,
            source: "agent",
          });
          const whiteReplies = updated.outcome
            ? []
            : legalMoves(updated.position, "white").map((reply) => reply.notation);
          return {
            played: move.notation,
            capture: true,
            winner: updated.outcome?.winner ?? null,
            whiteReplies,
            board: sessionBoardPayload(updated).board,
          };
        }

        case "list_threats": {
          requireNoArgs(rawArgs, name);
          if (gameOver) {
            throw new Error(
              "The game is over; call start_new_game before listing threats.",
            );
          }
          const currentThreats = threats(current.position);
          if (currentThreats.length === 0) {
            throw new Error(
              "There are no immediate rank threats now; call describe_board to inspect the position.",
            );
          }
          return {
            threats: currentThreats.map((threat) => ({
              side: threat.side,
              square: threat.square,
              goalRank: threat.goalRank,
            })),
          };
        }

        case "suggest_move": {
          if (gameOver || current.position.sideToMove !== "white") {
            throw new Error(
              "White is not choosing a move now; call describe_board and retry on White's turn.",
            );
          }
          const move = moveArg(
            rawArgs,
            legalMoves(current.position, "white"),
            name,
          );
          const updated = await dispatchAndCommit({ type: "setSuggestion", move });
          return {
            suggested: move.notation,
            moved: false,
            awaitingPlayer: `Click ${move.to} to accept the ghost arrow.`,
            board: sessionBoardPayload(updated).board,
          };
        }

        case "resign_game": {
          requireNoArgs(rawArgs, name);
          if (gameOver) {
            throw new Error("The game is already over; call start_new_game to play again.");
          }
          const accepted = EVAL_MODE
            ? true
            : await confirm("Resign the game for Black?", signal);
          if (!accepted) {
            return { resigned: false, reason: "cancelled by player" };
          }
          const updated = await dispatchAndCommit({ type: "resign", side: "black" });
          return {
            resigned: true,
            winner: updated.outcome?.winner ?? "white",
            board: sessionBoardPayload(updated).board,
          };
        }

        case "start_new_game": {
          requireNoArgs(rawArgs, name);
          const accepted = gameOver
            ? true
            : EVAL_MODE
              ? true
              : await confirm("Start a new game and clear the current board?", signal);
          if (!accepted) {
            return { started: false, reason: "cancelled by player" };
          }
          const updated = await dispatchAndCommit({
            type: "newGame",
            position: EVAL_MODE ? createEvalPosition() : undefined,
          });
          return { started: true, board: sessionBoardPayload(updated).board };
        }
      }
    },
    [confirm, dispatchAndCommit],
  );

  const executeTool = useCallback<ToolExecutor>(
    (name, args = {}, signal) => {
      const call = async () => {
        try {
          const result = await executeToolCore(name, args, signal);
          assertToolOutput(name, result);
          await appendTrace(name, args, result, false);
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await appendTrace(name, args, message, true);
          throw error instanceof Error ? error : new Error(message);
        }
      };

      const queued = toolQueueRef.current.then(call, call);
      toolQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [appendTrace, executeToolCore],
  );

  useEffect(() => {
    if (!EXPOSE_TEST_API) {
      delete window.__boardspeak;
      return;
    }

    window.__boardspeak = {
      getState: () => stateRef.current,
      executeTool: (name, args) => {
        const known = stateRef.current.registry.some((tool) => tool.name === name);
        if (!known) {
          return Promise.reject(
            new Error(`${name} is not registered in the current turn.`),
          );
        }
        return executeTool(name as ToolName, args ?? {});
      },
    };

    return () => {
      delete window.__boardspeak;
    };
  }, [executeTool]);

  useEffect(() => {
    if (
      !state.preferences.practice ||
      state.outcome ||
      state.position.sideToMove !== "white"
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      const current = stateRef.current;
      const move = chooseWhiteMove(current.position);
      if (!move || current.outcome || current.position.sideToMove !== "white") {
        return;
      }
      void dispatchAndCommit({ type: "move", move, source: "bot" });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [
    dispatchAndCommit,
    state.outcome,
    state.position,
    state.preferences.practice,
  ]);

  useEffect(() => {
    const move = state.position.lastMove;
    const moveKey = move
      ? `${state.position.moveNumber}-${move.pieceId}-${move.notation}`
      : null;
    const outcomeKey = state.outcome
      ? `${state.outcome.winner}-${state.outcome.reason}-${state.position.moveNumber}`
      : null;

    if (!state.preferences.narrate) {
      lastNarratedMoveRef.current = moveKey;
      lastNarratedOutcomeRef.current = outcomeKey;
      narrator.cancel();
      return;
    }

    const newMove = move && moveKey !== lastNarratedMoveRef.current;
    const newOutcome =
      state.outcome && outcomeKey !== lastNarratedOutcomeRef.current;
    lastNarratedMoveRef.current = moveKey;
    lastNarratedOutcomeRef.current = outcomeKey;

    if (!newMove && !newOutcome) {
      return;
    }

    let cancelled = false;
    void (async () => {
      if (newMove) {
        const side = move.side === "white" ? "White" : "Black";
        const phrase = move.capture
          ? `${side} ${move.from} takes ${move.to}.`
          : `${side} ${move.from} moves to ${move.to}.`;
        await narrator.speak(phrase);
      }
      if (!cancelled && newOutcome) {
        await narrator.speak(narrationWinText(state.outcome));
      }
    })();

    return () => {
      cancelled = true;
      narrator.cancel();
    };
  }, [
    narrator,
    state.outcome,
    state.position.lastMove,
    state.position.moveNumber,
    state.preferences.narrate,
  ]);

  const movesFromSelection = useMemo(() => selectedMoves(state), [state]);
  const legalTargets = useMemo(
    () => movesFromSelection.map((move) => move.to),
    [movesFromSelection],
  );

  const playMouseMove = useCallback(
    (move: Move) => {
      if (mouseMovePendingRef.current) {
        return;
      }
      mouseMovePendingRef.current = true;
      void dispatchAndCommit({ type: "move", move, source: "mouse" }).finally(
        () => {
          mouseMovePendingRef.current = false;
        },
      );
    },
    [dispatchAndCommit],
  );

  const onSquareClick = useCallback(
    (square: Square) => {
      if (state.outcome) {
        return;
      }

      const matchingMove = movesFromSelection.find((move) => move.to === square);
      if (matchingMove) {
        playMouseMove(matchingMove);
        return;
      }

      if (state.suggestion?.to === square) {
        playMouseMove(state.suggestion);
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
    [movesFromSelection, playMouseMove, state.outcome, state.position, state.selected, state.suggestion],
  );

  const requestNewGame = useCallback(async () => {
    const current = stateRef.current;
    const gameOver = Boolean(current.outcome ?? winner(current.position));
    const accepted =
      gameOver || (await confirm("Start a new game and clear the current board?"));
    if (accepted) {
      await dispatchAndCommit({
        type: "newGame",
        position: EVAL_MODE ? createEvalPosition() : undefined,
      });
    }
  }, [confirm, dispatchAndCommit]);

  const runDemo = useCallback(() => {
    const current = stateRef.current;
    if (current.outcome || current.position.sideToMove !== "black") {
      return;
    }
    const move = legalMoves(current.position, "black")[0];
    if (move) {
      void executeTool("play_move", { move: move.notation }).catch(() => undefined);
    }
  }, [executeTool]);

  const turn = state.position.sideToMove;
  const gameWinner = winnerText(state.outcome);
  const boardDisabled = Boolean(
    state.outcome || (state.preferences.practice && turn === "white"),
  );
  const demoEnabled = !state.outcome && turn === "black";

  return (
    <div className="game-shell">
      <a className="skip-link" href="#game-board">
        Skip to board
      </a>

      <WebMCPBridge
        executeTool={executeTool}
        onNativeSupport={setNativeSupported}
        state={state}
      />

      <header className="game-header">
        <div className="brand-lockup">
          <p className="brand-kicker">Open-source WebMCP game</p>
          <h1>Boardspeak</h1>
          <p className="tagline">Play it by hand. Play it by voice.</p>
        </div>

        <p className="loop-explainer">
          White clicks. Black speaks. The tool menu changes with the turn.
        </p>

        <div className="game-controls" aria-label="Game preferences">
          <button
            aria-pressed={state.preferences.practice}
            className="toggle-control"
            onClick={() =>
              dispatch({
                type: "setPractice",
                enabled: !state.preferences.practice,
              })
            }
            type="button"
          >
            <span aria-hidden="true" className="toggle-track">
              <span className="toggle-thumb" />
            </span>
            Play the board
          </button>
          <button
            aria-pressed={state.preferences.narrate}
            className="toggle-control"
            onClick={() =>
              dispatch({
                type: "setNarration",
                enabled: !state.preferences.narrate,
              })
            }
            type="button"
          >
            <span aria-hidden="true" className="toggle-track">
              <span className="toggle-thumb" />
            </span>
            Narrate moves
          </button>
          <button className="new-game-button" onClick={requestNewGame} type="button">
            New game
          </button>
        </div>
      </header>

      {nativeSupported !== null ? (
        <AgentBanner
          demoEnabled={demoEnabled}
          dismissed={state.bannerDismissed}
          nativeSupported={nativeSupported}
          onDemo={runDemo}
          onDismissedChange={(dismissed) =>
            dispatch({ type: "setBannerDismissed", dismissed })
          }
          showDemo={showDemo}
        />
      ) : null}

      <main className="game-layout" id="main-content">
        <section
          className="board-stage"
          id="game-board"
          aria-labelledby="board-heading"
          tabIndex={-1}
        >
          <div className="turn-bar">
            <div>
              <p className="panel-kicker">Move {Math.ceil(state.position.moveNumber / 2)}</p>
              <h2 id="board-heading">
                {state.outcome
                  ? `${state.outcome.winner === "white" ? "White" : "Black"} wins`
                  : `${turn === "white" ? "White" : "Black"} to move`}
              </h2>
            </div>
            <span className="turn-chip" data-side={turn}>
              {state.preferences.practice && turn === "white"
                ? "Board thinking…"
                : turn === "white"
                  ? "By hand"
                  : "By voice or mouse"}
            </span>
          </div>

          {gameWinner ? <p className="board-verdict">{gameWinner}</p> : null}

          <Board
            disabled={boardDisabled}
            legalTargets={legalTargets}
            onSquareClick={onSquareClick}
            selected={state.selected}
            state={state.position}
            suggestion={state.suggestion}
          />

          <div className="board-caption">
            <div className="board-guidance">
              <p>
                Select a pawn, then a marked square. Diagonal moves are allowed even
                without a capture.
              </p>
              <p className="win-summary">
                <strong>How to win:</strong> {RULES[2]}
              </p>
              <details className="how-to-play">
                <summary>How to play</summary>
                <ol>
                  {RULES.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ol>
                <p>
                  <strong>Notation:</strong> quiet moves use{" "}
                  <code>{NOTATION.move}</code>; captures use{" "}
                  <code>{NOTATION.capture}</code>.
                </p>
              </details>
            </div>
            {state.suggestion ? (
              <button
                className="quiet-action"
                onClick={() => dispatch({ type: "clearSuggestion" })}
                type="button"
              >
                Clear suggestion
              </button>
            ) : null}
          </div>

          <MoveLog
            announcement={state.announcement}
            entries={state.history}
            winnerText={gameWinner}
          />
        </section>

        <aside className="agent-column" aria-label="Agent tools and activity">
          <ToolRail entries={state.registry} />
          <CallTrace entries={state.trace} />
          <p className="voice-disclosure">
            Move text is always announced to screen readers. Browser speech works
            without a key; enhanced narration, when configured, is AI-generated.
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

export function Game() {
  return (
    <ConfirmProvider>
      <GameInner />
    </ConfirmProvider>
  );
}

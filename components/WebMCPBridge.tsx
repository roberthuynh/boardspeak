"use client";

import { useEffect, useMemo, useRef } from "react";
import { useWebMCP } from "use-webmcp-tool";
import { legalMoves, threats, winner } from "@/lib/breakthrough";
import type { SessionState } from "@/lib/game";
import {
  EMPTY_INPUT_SCHEMA,
  TOOL_META,
  moveInputSchema,
  type ToolName,
} from "@/lib/tools";

export type ToolExecutor = (
  name: ToolName,
  args: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;

interface WebMCPBridgeProps {
  readonly state: SessionState;
  readonly executeTool: ToolExecutor;
  readonly onNativeSupport: (supported: boolean) => void;
}

function useLifecycleSignal(active: boolean): React.MutableRefObject<AbortController> {
  const controller = useRef(new AbortController());

  useEffect(() => {
    if (active && controller.current.signal.aborted) {
      controller.current = new AbortController();
    }

    if (!active) {
      controller.current.abort();
    }

    return () => controller.current.abort();
  }, [active]);

  return controller;
}

export function WebMCPBridge({
  state,
  executeTool,
  onNativeSupport,
}: WebMCPBridgeProps) {
  const gameOver = Boolean(state.outcome ?? winner(state.position));
  const blackMoves = useMemo(
    () => (gameOver ? [] : legalMoves(state.position, "black")),
    [gameOver, state.position],
  );
  const captures = useMemo(
    () => blackMoves.filter((move) => move.capture),
    [blackMoves],
  );
  const whiteMoves = useMemo(
    () => (gameOver ? [] : legalMoves(state.position, "white")),
    [gameOver, state.position],
  );
  const currentThreats = useMemo(() => threats(state.position), [state.position]);
  const playMoveSchema = useMemo(() => moveInputSchema(blackMoves), [blackMoves]);
  const captureSchema = useMemo(() => moveInputSchema(captures), [captures]);
  const suggestionSchema = useMemo(() => moveInputSchema(whiteMoves), [whiteMoves]);
  const blackTurn = !gameOver && state.position.sideToMove === "black";
  const whiteTurn = !gameOver && state.position.sideToMove === "white";
  const resignController = useLifecycleSignal(!gameOver);
  const newGameController = useLifecycleSignal(true);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.boardspeakNativeWebmcp;
    const nativeSupported = previous
      ? previous === "true"
      : Boolean(document.modelContext);

    root.dataset.boardspeakNativeWebmcp = String(nativeSupported);
    onNativeSupport(nativeSupported);

    if (nativeSupported || document.modelContext) {
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-boardspeak-webmcp-polyfill]",
    );
    if (existing) {
      return;
    }

    const script = document.createElement("script");
    script.src = "/webmcp-polyfill.js";
    script.async = true;
    script.dataset.boardspeakWebmcpPolyfill = "true";
    document.head.append(script);
  }, [onNativeSupport]);

  useWebMCP<Record<string, never>, unknown>({
    ...TOOL_META.describe_board,
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true },
    execute: (args) => executeTool("describe_board", args),
  });

  useWebMCP<Record<string, never>, unknown>({
    ...TOOL_META.get_rules,
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true },
    execute: (args) => executeTool("get_rules", args),
  });

  useWebMCP<Record<string, never>, unknown>({
    ...TOOL_META.list_legal_moves,
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true },
    execute: (args) => executeTool("list_legal_moves", args),
  });

  useWebMCP<{ move: string }, unknown>({
    ...TOOL_META.play_move,
    inputSchema: playMoveSchema,
    annotations: { readOnlyHint: false },
    enabled: blackTurn,
    execute: (args) => executeTool("play_move", args),
  });

  useWebMCP<{ move: string }, unknown>({
    ...TOOL_META.play_capture,
    inputSchema: captureSchema,
    annotations: { readOnlyHint: false },
    enabled: blackTurn && captures.length > 0,
    execute: (args) => executeTool("play_capture", args),
  });

  useWebMCP<Record<string, never>, unknown>({
    ...TOOL_META.list_threats,
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true },
    enabled: currentThreats.length > 0,
    execute: (args) => executeTool("list_threats", args),
  });

  useWebMCP<{ move: string }, unknown>({
    ...TOOL_META.suggest_move,
    inputSchema: suggestionSchema,
    annotations: { readOnlyHint: false },
    enabled: whiteTurn,
    execute: (args) => executeTool("suggest_move", args),
  });

  useWebMCP<Record<string, never>, unknown>({
    ...TOOL_META.resign_game,
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: false },
    enabled: !gameOver,
    execute: (args) =>
      executeTool("resign_game", args, resignController.current.signal),
  });

  useWebMCP<Record<string, never>, unknown>({
    ...TOOL_META.start_new_game,
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: false },
    execute: (args) =>
      executeTool("start_new_game", args, newGameController.current.signal),
  });

  return null;
}

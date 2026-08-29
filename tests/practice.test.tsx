// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Game } from "@/components/Game";
import type { SessionState } from "@/lib/game";

class ModelContextStub extends EventTarget implements WebMCPModelContext {
  private readonly tools = new Map<string, WebMCPToolDefinition>();

  registerTool(
    tool: WebMCPToolDefinition,
    options?: { readonly signal?: AbortSignal },
  ): void {
    if (options?.signal?.aborted) {
      return;
    }

    if (this.tools.has(tool.name)) {
      throw new DOMException(`${tool.name} is already registered.`, "InvalidStateError");
    }

    this.tools.set(tool.name, tool);
    options?.signal?.addEventListener(
      "abort",
      () => {
        if (this.tools.get(tool.name) === tool) {
          this.tools.delete(tool.name);
        }
      },
      { once: true },
    );
  }
}

function currentSession(): SessionState {
  const state = window.__boardspeak?.getState();
  if (!state) {
    throw new Error("Boardspeak test API is not ready.");
  }
  return state as SessionState;
}

describe("practice and coaching", () => {
  beforeEach(() => {
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: new ModelContextStub(),
    });
    delete document.documentElement.dataset.boardspeakNativeWebmcp;
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete window.__boardspeak;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: undefined,
    });
    delete document.documentElement.dataset.boardspeakNativeWebmcp;
  });

  it("moves White after 300ms in Play the board mode and records the bot source", async () => {
    vi.useFakeTimers();
    render(<Game />);

    const practiceToggle = screen.getByRole("button", { name: "Play the board" });
    expect(practiceToggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(practiceToggle);
    expect(practiceToggle).toHaveAttribute("aria-pressed", "true");
    expect(currentSession().history).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(currentSession().history).toHaveLength(0);
    expect(currentSession().position.sideToMove).toBe("white");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(currentSession().history).toHaveLength(1);
    expect(currentSession().history[0]?.source).toBe("bot");
    expect(currentSession().position.sideToMove).toBe("black");
    expect(currentSession().position.lastMove?.notation).toBe(
      currentSession().history[0]?.notation,
    );
    expect(screen.getByRole("heading", { name: "Black to move" })).toBeVisible();
  });

  it("draws a suggestion without moving and accepts it through the mouse reducer", async () => {
    const { container } = render(<Game />);
    await waitFor(() => expect(window.__boardspeak).toBeDefined());

    const before = currentSession();
    const beforePieces = before.position.pieces.map((piece) => ({ ...piece }));

    let suggestionExecution: Promise<unknown> | undefined;
    act(() => {
      suggestionExecution = window.__boardspeak?.executeTool("suggest_move", {
        move: "e2-e3",
      });
    });

    await waitFor(() =>
      expect(currentSession().suggestion?.notation).toBe("e2-e3"),
    );
    await suggestionExecution;
    expect(currentSession().position.pieces).toEqual(beforePieces);
    expect(currentSession().position.lastMove).toBeNull();
    expect(currentSession().history).toHaveLength(0);
    expect(currentSession().suggestion?.notation).toBe("e2-e3");

    const arrow = container.querySelector(".suggestion-arrow");
    expect(arrow).toHaveAttribute("data-from", "e2");
    expect(arrow).toHaveAttribute("data-to", "e3");

    fireEvent.click(
      container.querySelector<HTMLButtonElement>('button[data-square="e3"]')!,
    );

    await waitFor(() =>
      expect(currentSession().position.lastMove?.notation).toBe("e2-e3"),
    );
    expect(currentSession().history).toHaveLength(1);
    expect(currentSession().history[0]?.source).toBe("mouse");
    expect(currentSession().suggestion).toBeNull();
    expect(container.querySelector(".suggestion-arrow")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Black to move" })).toBeVisible();
  });

  it("prefers the player's selected move over a suggestion with the same target", async () => {
    const { container } = render(<Game />);
    await waitFor(() => expect(window.__boardspeak).toBeDefined());

    let suggestionExecution: Promise<unknown> | undefined;
    act(() => {
      suggestionExecution = window.__boardspeak?.executeTool("suggest_move", {
        move: "e2-d3",
      });
    });
    await waitFor(() =>
      expect(currentSession().suggestion?.notation).toBe("e2-d3"),
    );
    await suggestionExecution;

    fireEvent.click(
      container.querySelector<HTMLButtonElement>('button[data-square="c2"]')!,
    );
    expect(currentSession().selected).toBe("c2");

    fireEvent.click(
      container.querySelector<HTMLButtonElement>('button[data-square="d3"]')!,
    );
    await waitFor(() =>
      expect(currentSession().position.lastMove?.notation).toBe("c2-d3"),
    );
    expect(currentSession().position.pieces.some((piece) => piece.square === "e2")).toBe(
      true,
    );
  });
});

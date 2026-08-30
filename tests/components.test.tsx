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
import { AgentBanner } from "@/components/AgentBanner";
import { BlackVoiceControl } from "@/components/BlackVoiceControl";
import { Board } from "@/components/Board";
import { Game } from "@/components/Game";
import { MoveLog } from "@/components/MoveLog";
import { initialState } from "@/lib/breakthrough";
import { NOTATION, RULES } from "@/lib/tools";

function boardButton(container: HTMLElement, square: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `button[data-square="${square}"]`,
  );
  if (!button) {
    throw new Error(`Board button ${square} was not rendered.`);
  }
  return button;
}

describe("accessible board experience", () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "SpeechRecognition");
    Reflect.deleteProperty(window, "webkitSpeechRecognition");
  });

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it("renders 64 native square buttons with exact occupancy labels", () => {
    render(
      <Board
        legalTargets={[]}
        onSquareClick={() => undefined}
        selected={null}
        state={initialState()}
        suggestion={null}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(64);
    expect(screen.getByRole("button", { name: "e2, white pawn" })).toBeVisible();
    expect(screen.getByRole("button", { name: "e4, empty" })).toBeVisible();
    expect(screen.getByRole("button", { name: "e7, black pawn" })).toBeVisible();
  });

  it("keeps an inactive board focusable for position inspection", () => {
    const onSquareClick = vi.fn();
    render(
      <Board
        disabled
        legalTargets={[]}
        onSquareClick={onSquareClick}
        selected={null}
        state={initialState()}
        suggestion={null}
      />,
    );

    const square = screen.getByRole("button", { name: "e2, white pawn" });
    expect(square).toHaveAttribute("aria-disabled", "true");
    expect(square).not.toBeDisabled();
    square.focus();
    expect(square).toHaveFocus();
    fireEvent.click(square);
    expect(onSquareClick).not.toHaveBeenCalled();
  });

  it("names empty legal destinations and occupied legal captures", () => {
    const state = initialState();
    const captureState = {
      ...state,
      pieces: state.pieces.map((piece) =>
        piece.square === "d7" ? { ...piece, square: "d3" as const } : piece,
      ),
    };

    render(
      <Board
        legalTargets={["d3", "e3"]}
        onSquareClick={() => undefined}
        selected="e2"
        state={captureState}
        suggestion={null}
      />,
    );

    expect(
      screen.getByRole("button", { name: "e3, empty, legal destination" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "d3, black pawn, legal capture" }),
    ).toBeVisible();
  });

  it("plays White and Black by clicking the same board", async () => {
    const { container } = render(<Game />);

    fireEvent.click(boardButton(container, "e2"));
    fireEvent.click(boardButton(container, "e3"));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Black to move" }),
      ).toBeVisible(),
    );

    fireEvent.click(boardButton(container, "e7"));
    fireEvent.click(boardButton(container, "e6"));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "White to move" }),
      ).toBeVisible(),
    );
    expect(screen.getAllByText("Black e7 moves to e6")).toHaveLength(1);
  });

  it("makes the current side and its input method obvious", async () => {
    const { container } = render(<Game />);

    expect(screen.getByRole("button", { name: "Bot plays White" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText(/White uses the mouse:/)).toHaveTextContent(
      "click a White pawn, then a highlighted square. Or turn on Bot plays White.",
    );
    expect(screen.getByText(/White to move now:/)).toHaveTextContent(
      "click a White pawn, then a highlighted square.",
    );
    expect(container.querySelector('.player-input-map [data-active="true"]')).toHaveTextContent(
      "WhiteMouseNow",
    );

    fireEvent.click(boardButton(container, "e2"));
    fireEvent.click(boardButton(container, "e3"));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Black to move" })).toBeVisible(),
    );
    expect(screen.getByText(/Black uses voice or an agent:/)).toHaveTextContent(
      "use the on-page mic if shown, or ask your agent to move.",
    );
    expect(screen.getByText(/Black to move now:/)).toHaveTextContent(
      "speak a move or ask your agent.",
    );
    expect(container.querySelector('.player-input-map [data-active="true"]')).toHaveTextContent(
      "BlackVoice / agentNow",
    );
  });

  it("shows an explicit fallback when browser speech recognition is unavailable", async () => {
    const onMove = vi.fn();
    render(
      <BlackVoiceControl
        legalNotations={["e7-e6"]}
        onAnnounce={() => undefined}
        onCancelOptions={() => undefined}
        onMove={onMove}
        onOptions={async () => "web-speech"}
      />,
    );

    const button = await screen.findByRole("button", { name: "Mic unavailable" });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(
        "Voice input is unavailable here. Move Black with an agent or the mouse.",
      ),
    ).toBeVisible();
    fireEvent.click(button);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("listens for a supported spoken move and submits the matched notation", async () => {
    class FakeSpeechRecognition {
      static instance: FakeSpeechRecognition | null = null;
      static abortCount = 0;
      static startCount = 0;
      continuous = false;
      interimResults = false;
      lang = "";
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult: ((event: {
        results: ArrayLike<{ length: number; 0: { transcript: string } }>;
      }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;

      constructor() {
        FakeSpeechRecognition.instance = this;
      }

      start() {
        FakeSpeechRecognition.startCount += 1;
      }

      begin() {
        this.onstart?.();
      }

      abort() {
        FakeSpeechRecognition.abortCount += 1;
        this.onerror?.({ error: "aborted" });
      }

      emit(transcript: string, alternative?: string) {
        const result = alternative
          ? {
              0: { transcript },
              1: { transcript: alternative },
              length: 2,
            }
          : { 0: { transcript }, length: 1 };
        this.onresult?.({
          results: [result],
        });
        this.onend?.();
      }

      finishWithoutSpeech() {
        this.onend?.();
      }
    }

    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: FakeSpeechRecognition,
    });
    const onAnnounce = vi.fn();
    let resolveMove: (() => void) | undefined;
    let resolveOptions: ((result: "cancelled") => void) | undefined;
    const onMove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveMove = resolve;
        }),
    );
    let optionsCall = 0;
    const onOptions = vi.fn(() => {
      optionsCall += 1;
      return optionsCall === 1
        ? new Promise<"cancelled">((resolve) => {
            resolveOptions = resolve;
          })
        : Promise.resolve("unavailable" as const);
    });
    const onCancelOptions = vi.fn();
    const { unmount } = render(
      <BlackVoiceControl
        legalNotations={["e7-e6"]}
        onAnnounce={onAnnounce}
        onCancelOptions={onCancelOptions}
        onMove={onMove}
        onOptions={onOptions}
      />,
    );

    const speak = await screen.findByRole("button", { name: "Speak Black move" });
    fireEvent.click(speak);
    const waiting = screen.getByRole("button", { name: "Waiting for mic…" });
    expect(waiting).toHaveAttribute("aria-disabled", "true");
    expect(waiting).not.toBeDisabled();
    fireEvent.click(waiting);
    expect(FakeSpeechRecognition.startCount).toBe(1);

    act(() => FakeSpeechRecognition.instance?.begin());
    expect(screen.getByRole("button", { name: "Stop listening" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(onAnnounce).toHaveBeenCalledWith(
      "Listening for Black's move or options.",
    );

    act(() =>
      FakeSpeechRecognition.instance?.emit("e seven to e six", "options"),
    );
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("e7-e6"));
    const submitting = screen.getByRole("button", { name: "Playing move…" });
    expect(submitting).toHaveAttribute("aria-disabled", "true");
    expect(submitting).not.toBeDisabled();
    await act(async () => resolveMove?.());
    await waitFor(() => expect(screen.getByText("Played e7-e6.")).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: "Speak Black move" }));
    act(() => FakeSpeechRecognition.instance?.begin());
    act(() => FakeSpeechRecognition.instance?.emit("options"));
    await waitFor(() => expect(onOptions).toHaveBeenCalledTimes(1));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Stop reading options" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "Stop reading options" }),
    );
    expect(onCancelOptions).toHaveBeenCalledTimes(1);
    await act(async () => resolveOptions?.("cancelled"));
    expect(screen.getByText("Options readout stopped.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Speak Black move" }));
    act(() => FakeSpeechRecognition.instance?.begin());
    act(() => FakeSpeechRecognition.instance?.emit("options"));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Speech playback is unavailable. Your legal moves were sent to the screen reader.",
        ),
      ).toBeVisible(),
    );
    expect(onOptions).toHaveBeenCalledTimes(2);
    expect(onMove).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Speak Black move" }));
    act(() => FakeSpeechRecognition.instance?.begin());
    act(() => FakeSpeechRecognition.instance?.emit("what else can I do"));
    await waitFor(() =>
      expect(onAnnounce).toHaveBeenCalledWith(
        "I heard “what else can I do.” That is not a current legal move. Say a move like “e7 to e6,” or say “options” to hear your moves.",
      ),
    );
    expect(onOptions).toHaveBeenCalledTimes(2);
    expect(onMove).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Speak Black move" }));
    act(() => FakeSpeechRecognition.instance?.begin());
    act(() => FakeSpeechRecognition.instance?.finishWithoutSpeech());
    await waitFor(() =>
      expect(onAnnounce).toHaveBeenCalledWith(
        "No command was heard. Say a move like “e7 to e6,” or say “options” to hear your moves.",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Speak Black move" }));
    act(() => FakeSpeechRecognition.instance?.begin());
    unmount();
    expect(FakeSpeechRecognition.abortCount).toBe(1);
    expect(onCancelOptions).toHaveBeenCalledTimes(2);
  });

  it("routes reducer messages through one polite status region", async () => {
    const { container } = render(<Game />);

    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("White to move.");

    fireEvent.click(screen.getByRole("button", { name: "Narrate moves" }));
    await waitFor(() => expect(status).toHaveTextContent("Move narration off."));
  });

  it("announces selection destinations and clearing through the status region", () => {
    const { container } = render(<Game />);
    const status = screen.getByRole("status");

    fireEvent.click(boardButton(container, "e2"));
    expect(status).toHaveTextContent(
      "White pawn e2 selected. Legal destinations: d3, e3, f3.",
    );

    fireEvent.click(boardButton(container, "e2"));
    expect(status).toHaveTextContent("Selection cleared.");
  });

  it("does not announce selection clearing for clean-board empty or opponent clicks", () => {
    const { container } = render(<Game />);
    const status = screen.getByRole("status");

    expect(status).toHaveTextContent("White to move.");
    fireEvent.click(boardButton(container, "e4"));
    expect(status).toHaveTextContent("White to move.");
    expect(status).not.toHaveTextContent("Selection cleared.");

    fireEvent.click(boardButton(container, "e7"));
    expect(status).toHaveTextContent("White to move.");
    expect(status).not.toHaveTextContent("Selection cleared.");
  });

  it("keeps move and win announcements in one polite live region", () => {
    const { container } = render(
      <MoveLog
        announcement="White e2 moves to e3. White wins: reached the far rank."
        entries={[{ notation: "e2-e3", plainText: "White e2 moves to e3" }]}
        winnerText="White wins: reached the far rank."
      />,
    );

    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toHaveTextContent(
      "White e2 moves to e3. White wins: reached the far rank.",
    );
  });

  it("keeps plain-browser actions available while setup copy is hidden", () => {
    const onDismissedChange = vi.fn();
    const onDemo = vi.fn();
    const { rerender } = render(
      <AgentBanner
        demoEnabled={false}
        dismissed={false}
        nativeSupported={false}
        onDemo={onDemo}
        onDismissedChange={onDismissedChange}
        showDemo
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Agent play needs WebMCP" }),
    ).toBeVisible();
    expect(screen.getByText("Plain browser mode")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/ChatGPT desktop:/)).toBeVisible();
    expect(screen.getByText(/Chrome 149\+:/)).toBeVisible();

    const hide = screen.getByRole("button", { name: "Hide setup" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(hide);
    expect(onDismissedChange).toHaveBeenCalledWith(true);

    rerender(
      <AgentBanner
        demoEnabled
        dismissed
        nativeSupported={false}
        onDemo={onDemo}
        onDismissedChange={onDismissedChange}
        showDemo
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "Agent play needs WebMCP" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Plain browser mode")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Demo: agent turn" }),
    ).toBeVisible();
    const show = screen.getByRole("button", { name: "Show agent setup" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(show);
    expect(onDismissedChange).toHaveBeenCalledWith(false);
  });

  it("renders the game credit, shared rules, and notation beside the board", () => {
    const { container } = render(<Game />);

    expect(container.querySelector(".win-summary")).toHaveTextContent(RULES[2]);
    const gameCredit = container.querySelector(".game-credit");
    expect(gameCredit).toBeVisible();
    expect(gameCredit).toHaveTextContent(
      "Game: Breakthrough, created by Dan Troyka.",
    );
    const details = screen.getByText("How to play").closest("details");
    expect(details).not.toBeNull();
    for (const rule of RULES) {
      expect(details).toHaveTextContent(rule);
    }
    expect(details).toHaveTextContent(NOTATION.move);
    expect(details).toHaveTextContent(NOTATION.capture);
  });
});

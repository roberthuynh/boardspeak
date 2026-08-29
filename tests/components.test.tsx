// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBanner } from "@/components/AgentBanner";
import { Board } from "@/components/Board";
import { Game } from "@/components/Game";
import { MoveLog } from "@/components/MoveLog";
import { initialState } from "@/lib/breakthrough";
import { NOTATION, RULES } from "@/lib/tools";

describe("accessible board experience", () => {
  afterEach(() => cleanup());

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

  it("plays White and Black by clicking the same board", async () => {
    render(<Game />);

    fireEvent.click(screen.getByRole("button", { name: "e2, white pawn" }));
    fireEvent.click(screen.getByRole("button", { name: "e3, empty" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Black to move" }),
      ).toBeVisible(),
    );

    fireEvent.click(screen.getByRole("button", { name: "e7, black pawn" }));
    fireEvent.click(screen.getByRole("button", { name: "e6, empty" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "White to move" }),
      ).toBeVisible(),
    );
    expect(screen.getAllByText("Black e7 moves to e6")).toHaveLength(1);
  });

  it("routes reducer messages through one polite status region", async () => {
    const { container } = render(<Game />);

    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("White to move.");

    fireEvent.click(screen.getByRole("button", { name: "Narrate moves" }));
    await waitFor(() => expect(status).toHaveTextContent("Move narration off."));
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
      screen.getByRole("heading", { name: "Voice play needs WebMCP" }),
    ).toBeVisible();
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
      screen.queryByRole("heading", { name: "Voice play needs WebMCP" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Demo: agent turn" }),
    ).toBeVisible();
    const show = screen.getByRole("button", { name: "Show agent setup" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(show);
    expect(onDismissedChange).toHaveBeenCalledWith(false);
  });

  it("renders shared rules and notation beside the board", () => {
    const { container } = render(<Game />);

    expect(container.querySelector(".win-summary")).toHaveTextContent(RULES[2]);
    const details = screen.getByText("How to play").closest("details");
    expect(details).not.toBeNull();
    for (const rule of RULES) {
      expect(details).toHaveTextContent(rule);
    }
    expect(details).toHaveTextContent(NOTATION.move);
    expect(details).toHaveTextContent(NOTATION.capture);
  });
});

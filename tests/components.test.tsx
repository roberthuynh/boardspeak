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
import { Board } from "@/components/Board";
import { Game } from "@/components/Game";
import { MoveLog } from "@/components/MoveLog";
import { initialState } from "@/lib/breakthrough";

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
    expect(screen.getAllByText("Black e7 moves to e6")).toHaveLength(2);
  });

  it("keeps move and win announcements in one polite live region", () => {
    const { container } = render(
      <MoveLog
        entries={[{ notation: "e2-e3", plainText: "White e2 moves to e3" }]}
        winnerText="White wins: reached the far rank."
      />,
    );

    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toHaveTextContent(
      "White e2 moves to e3. White wins: reached the far rank.",
    );
  });
});

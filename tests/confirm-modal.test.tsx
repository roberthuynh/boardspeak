// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfirmProvider, useConfirm } from "@/components/ConfirmModal";

function installDialogPrimitives() {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
}

function ConfirmHarness({ signal }: { signal?: AbortSignal }) {
  const confirm = useConfirm();
  const [answer, setAnswer] = useState("waiting");

  return (
    <>
      <button
        onClick={async () => {
          setAnswer(String(await confirm("Resign the game for Black?", signal)));
        }}
        type="button"
      >
        Ask to resign
      </button>
      <output aria-label="Confirmation result">{answer}</output>
    </>
  );
}

describe("ConfirmProvider", () => {
  beforeEach(() => installDialogPrimitives());
  afterEach(() => cleanup());

  it("treats the native Escape cancel event as false and restores focus", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <ConfirmHarness />
      </ConfirmProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Ask to resign" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog).toHaveAttribute("open"));

    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    expect(await screen.findByRole("status", { name: "Confirmation result" })).toHaveTextContent(
      "false",
    );
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
  });

  it("resolves false and closes when the tool lifecycle aborts", async () => {
    const user = userEvent.setup();
    const controller = new AbortController();
    render(
      <ConfirmProvider>
        <ConfirmHarness signal={controller.signal} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Ask to resign" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog).toHaveAttribute("open"));

    controller.abort();

    expect(await screen.findByRole("status", { name: "Confirmation result" })).toHaveTextContent(
      "false",
    );
    expect(dialog).not.toHaveAttribute("open");
  });
});

"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type Confirm = (message: string, signal?: AbortSignal) => Promise<boolean>;

interface ConfirmRequest {
  id: number;
  message: string;
  signal?: AbortSignal;
  opener: HTMLElement | null;
  resolve: (confirmed: boolean) => void;
  onAbort?: () => void;
}

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm() {
  const confirm = useContext(ConfirmContext);

  if (!confirm) {
    throw new Error("useConfirm must be used inside ConfirmProvider");
  }

  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queueRef = useRef<ConfirmRequest[]>([]);
  const activeRef = useRef<ConfirmRequest | null>(null);
  const nextIdRef = useRef(0);
  const finishRef = useRef<(confirmed: boolean) => void>(() => undefined);
  const [active, setActive] = useState<ConfirmRequest | null>(null);

  const activateNext = useCallback(() => {
    if (activeRef.current) {
      return;
    }

    let next = queueRef.current.shift();
    while (next?.signal?.aborted) {
      next.signal.removeEventListener("abort", next.onAbort!);
      next.resolve(false);
      next = queueRef.current.shift();
    }

    if (!next) {
      return;
    }

    activeRef.current = next;
    setActive(next);
  }, []);

  const finish = useCallback(
    (confirmed: boolean) => {
      const request = activeRef.current;
      if (!request) {
        return;
      }

      activeRef.current = null;
      if (request.signal && request.onAbort) {
        request.signal.removeEventListener("abort", request.onAbort);
      }

      const dialog = dialogRef.current;
      if (dialog?.open) {
        dialog.close();
      }

      setActive(null);
      request.resolve(confirmed);
      if (request.opener?.isConnected) {
        request.opener.focus();
      }

      queueMicrotask(activateNext);
    },
    [activateNext],
  );

  finishRef.current = finish;

  const confirm = useCallback<Confirm>(
    (message, signal) => {
      if (signal?.aborted) {
        return Promise.resolve(false);
      }

      return new Promise<boolean>((resolve) => {
        const request: ConfirmRequest = {
          id: nextIdRef.current++,
          message,
          signal,
          opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
          resolve,
        };

        request.onAbort = () => {
          if (activeRef.current?.id === request.id) {
            finishRef.current(false);
            return;
          }

          const index = queueRef.current.findIndex((queued) => queued.id === request.id);
          if (index >= 0) {
            queueRef.current.splice(index, 1);
            request.signal?.removeEventListener("abort", request.onAbort!);
            request.resolve(false);
          }
        };

        signal?.addEventListener("abort", request.onAbort, { once: true });
        queueRef.current.push(request);
        activateNext();
      });
    },
    [activateNext],
  );

  useEffect(() => {
    if (active && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  }, [active]);

  useEffect(
    () => () => {
      const pending = [activeRef.current, ...queueRef.current].filter(
        (request): request is ConfirmRequest => Boolean(request),
      );
      activeRef.current = null;
      queueRef.current = [];
      for (const request of pending) {
        if (request.signal && request.onAbort) {
          request.signal.removeEventListener("abort", request.onAbort);
        }
        request.resolve(false);
      }
    },
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        aria-labelledby="confirm-modal-title"
        className="confirm-modal"
        onCancel={(event) => {
          event.preventDefault();
          finish(false);
        }}
        onClose={() => {
          if (activeRef.current) {
            finish(dialogRef.current?.returnValue === "confirm");
          }
        }}
        ref={dialogRef}
      >
        <form method="dialog">
          <p className="panel-kicker">Your board, your call</p>
          <h2 id="confirm-modal-title">Please confirm</h2>
          <p>{active?.message}</p>
          <div className="confirm-actions">
            <button autoFocus type="submit" value="cancel">
              Cancel
            </button>
            <button className="primary-action" type="submit" value="confirm">
              Confirm
            </button>
          </div>
        </form>
      </dialog>
    </ConfirmContext.Provider>
  );
}

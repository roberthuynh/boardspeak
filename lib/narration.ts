const MAX_NARRATION_TEXT_LENGTH = 180;
const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,94}[A-Za-z0-9])$/;

const SIDE = "(?:White|Black)";
const SQUARE = "[a-h][1-8]";

const MOVE_PHRASE_PATTERN = new RegExp(
  `^(?:${SIDE} ${SQUARE} (?:moves|advances|slides|steps)(?: forward)? to ${SQUARE}|${SIDE} (?:moves|advances|slides|steps) ${SQUARE} to ${SQUARE}|${SIDE} ${SQUARE} (?:takes|captures) ${SQUARE}|${SIDE} (?:takes|captures) ${SQUARE} (?:from|with) ${SQUARE})[.!]?$`,
  "i",
);

const WIN_PHRASE_PATTERN = new RegExp(
  `^${SIDE} wins(?: by (?:reaching (?:rank (?:1|8|one|eight)|the (?:far|goal|last) rank)|capturing (?:all|every) (?:opposing |enemy |${SIDE} )?pawns?|annihilation)| because ${SIDE} has no legal moves| after ${SIDE} resigns)?[.!]?(?: ${SIDE} has no legal moves[.!]?)?$`,
  "i",
);

const RESIGNATION_PHRASE_PATTERN = new RegExp(
  `^${SIDE} resigns[.!]?(?: ${SIDE} wins[.!]?)?$`,
  "i",
);

export function normalizeNarrationText(text: string): string {
  return text.trim().replace(/[\t ]+/g, " ");
}

export function isNarrationText(text: unknown): text is string {
  if (typeof text !== "string" || /[\r\n\0]/.test(text)) {
    return false;
  }

  const normalized = normalizeNarrationText(text);

  if (
    normalized.length === 0 ||
    normalized.length > MAX_NARRATION_TEXT_LENGTH
  ) {
    return false;
  }

  return (
    MOVE_PHRASE_PATTERN.test(normalized) ||
    WIN_PHRASE_PATTERN.test(normalized) ||
    RESIGNATION_PHRASE_PATTERN.test(normalized)
  );
}

export function isNarrationSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

export type NarrationResult =
  | "openai"
  | "web-speech"
  | "cancelled"
  | "unavailable";

export interface NarrationRuntime {
  fetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  playAudio: (audio: Blob, signal: AbortSignal) => Promise<void>;
  speakWithWebSpeech: (text: string, signal: AbortSignal) => Promise<void>;
  cancelSpeech: () => void;
}

export interface NarrateTextOptions {
  endpoint?: string;
  runtime?: Partial<NarrationRuntime>;
  sessionId: string;
  signal?: AbortSignal;
}

export interface Narrator {
  readonly sessionId: string;
  cancel: () => void;
  speak: (text: string) => Promise<NarrationResult>;
}

export interface CreateNarratorOptions {
  endpoint?: string;
  runtime?: Partial<NarrationRuntime>;
  sessionId?: string;
}

function createAbortError(): Error {
  const error = new Error("Narration cancelled");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

async function playAudioInBrowser(
  audioBlob: Blob,
  signal: AbortSignal,
): Promise<void> {
  if (
    typeof Audio === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    throw new Error("Audio playback is unavailable");
  }

  if (signal.aborted) {
    throw createAbortError();
  }

  const objectUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(objectUrl);

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      signal.removeEventListener("abort", onAbort);
      audio.onended = null;
      audio.onerror = null;
      URL.revokeObjectURL(objectUrl);

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const onAbort = () => {
      audio.pause();
      audio.currentTime = 0;
      finish(createAbortError());
    };

    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("Audio playback failed"));
    signal.addEventListener("abort", onAbort, { once: true });

    void audio.play().catch(() => {
      finish(new Error("Audio playback was blocked"));
    });
  });
}

function speakWithBrowserSpeech(
  text: string,
  signal: AbortSignal,
): Promise<void> {
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window) ||
    typeof SpeechSynthesisUtterance === "undefined"
  ) {
    return Promise.reject(new Error("Web Speech is unavailable"));
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  const synthesis = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.04;
  utterance.pitch = 1;

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      signal.removeEventListener("abort", onAbort);
      utterance.onend = null;
      utterance.onerror = null;

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const onAbort = () => {
      synthesis.cancel();
      finish(createAbortError());
    };

    utterance.onend = () => finish();
    utterance.onerror = () => finish(new Error("Web Speech failed"));
    signal.addEventListener("abort", onAbort, { once: true });
    synthesis.speak(utterance);
  });
}

function defaultRuntime(): NarrationRuntime {
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    playAudio: playAudioInBrowser,
    speakWithWebSpeech: speakWithBrowserSpeech,
    cancelSpeech: () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    },
  };
}

function resolveRuntime(overrides?: Partial<NarrationRuntime>): NarrationRuntime {
  return { ...defaultRuntime(), ...overrides };
}

export async function narrateText(
  text: string,
  options: NarrateTextOptions,
): Promise<NarrationResult> {
  const runtime = resolveRuntime(options.runtime);
  const signal = options.signal ?? new AbortController().signal;

  if (signal.aborted) {
    return "cancelled";
  }

  try {
    const response = await runtime.fetch(options.endpoint ?? "/api/narrate", {
      body: JSON.stringify({ text, sessionId: options.sessionId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal,
    });

    if (
      response.ok &&
      response.headers.get("content-type")?.startsWith("audio/mpeg")
    ) {
      await runtime.playAudio(await response.blob(), signal);
      return "openai";
    }
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      return "cancelled";
    }
  }

  if (signal.aborted) {
    return "cancelled";
  }

  try {
    await runtime.speakWithWebSpeech(text, signal);
    return "web-speech";
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      return "cancelled";
    }

    return "unavailable";
  }
}

export function createNarrationSessionId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createNarrator(
  options: CreateNarratorOptions = {},
): Narrator {
  const runtime = resolveRuntime(options.runtime);
  const sessionId = options.sessionId ?? createNarrationSessionId();
  let activeController: AbortController | null = null;

  const cancel = () => {
    activeController?.abort();
    activeController = null;
    runtime.cancelSpeech();
  };

  return {
    sessionId,
    cancel,
    speak: async (text) => {
      cancel();

      const controller = new AbortController();
      activeController = controller;

      const result = await narrateText(text, {
        endpoint: options.endpoint,
        runtime,
        sessionId,
        signal: controller.signal,
      });

      if (activeController === controller) {
        activeController = null;
      }

      return result;
    },
  };
}

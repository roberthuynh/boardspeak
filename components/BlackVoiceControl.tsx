"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LocalNarrationResult } from "@/lib/narration";
import {
  isVoiceOptionsCommand,
  matchSpokenMove,
  spokenMoveExample,
} from "@/lib/voice-input";

interface SpeechAlternativeLike {
  readonly transcript: string;
}

interface SpeechResultLike {
  readonly length: number;
  readonly [index: number]: SpeechAlternativeLike;
}

interface SpeechResultEventLike extends Event {
  readonly results: ArrayLike<SpeechResultLike>;
}

interface SpeechErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type VoiceWindow = Window & {
  readonly SpeechRecognition?: SpeechRecognitionConstructor;
  readonly webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

type VoicePhase =
  | "idle"
  | "requesting"
  | "listening"
  | "submitting"
  | "reading-options";

interface BlackVoiceControlProps {
  readonly legalNotations: readonly string[];
  readonly onAnnounce: (message: string) => void;
  readonly onCancelOptions: () => void;
  readonly onMove: (notation: string) => Promise<void>;
  readonly onOptions: () => Promise<LocalNarrationResult>;
  readonly showUnavailable?: boolean;
}

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  const voiceWindow = window as VoiceWindow;
  return (
    voiceWindow.SpeechRecognition ??
    voiceWindow.webkitSpeechRecognition ??
    null
  );
}

function voiceInstruction(example: string): string {
  return `Say a move like “${example},” or say “options” to hear your moves.`;
}

function recognitionError(error: string, instruction: string): string {
  switch (error) {
    case "aborted":
      return "Listening stopped.";
    case "audio-capture":
      return "No microphone was found. Use your agent or the mouse for Black.";
    case "network":
      return "Speech recognition could not connect. Try again or use your agent.";
    case "no-speech":
      return `No command was heard. ${instruction}`;
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it or ask your agent to move Black.";
    default:
      return "Voice input stopped. Try again or ask your agent to move Black.";
  }
}

export function BlackVoiceControl({
  legalNotations,
  onAnnounce,
  onCancelOptions,
  onMove,
  onOptions,
  showUnavailable = true,
}: BlackVoiceControlProps) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mountedRef = useRef(true);
  const optionsRunRef = useRef(0);
  const example = useMemo(
    () => spokenMoveExample(legalNotations[0] ?? "e7-e6"),
    [legalNotations],
  );

  useEffect(() => {
    mountedRef.current = true;
    setSupported(Boolean(recognitionConstructor()));

    return () => {
      mountedRef.current = false;
      optionsRunRef.current += 1;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      onCancelOptions();
    };
  }, [onCancelOptions]);

  const instruction = voiceInstruction(example);

  const defaultFeedback =
    supported === null
      ? "Checking browser microphone support…"
      : supported
        ? instruction
        : "Voice input is unavailable here. Move Black with an agent or the mouse.";
  const message = feedback ?? defaultFeedback;
  const listening = phase === "listening";
  const readingOptions = phase === "reading-options";
  const unavailable = supported !== true || legalNotations.length === 0;
  const locked = unavailable || phase === "requesting" || phase === "submitting";

  const beginListening = () => {
    if (readingOptions) {
      optionsRunRef.current += 1;
      onCancelOptions();
      setPhase("idle");
      setFeedback("Options readout stopped.");
      onAnnounce("Options readout stopped.");
      return;
    }

    if (listening) {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      setPhase("idle");
      setFeedback("Listening stopped.");
      onAnnounce("Black voice input stopped.");
      return;
    }

    if (phase !== "idle") {
      return;
    }

    const Recognition = recognitionConstructor();
    if (!Recognition || legalNotations.length === 0) {
      return;
    }

    const recognition = new Recognition();
    let handled = false;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 3;
    recognitionRef.current = recognition;
    setPhase("requesting");
    setFeedback("Waiting for microphone…");
    onAnnounce("Waiting for microphone permission.");

    recognition.onstart = () => {
      if (!mountedRef.current) return;
      setPhase("listening");
      setFeedback("Listening for Black’s move or options…");
      onAnnounce("Listening for Black's move or options.");
    };

    recognition.onresult = (event) => {
      if (!mountedRef.current) return;
      handled = true;
      const transcripts = Array.from(event.results).flatMap((result) =>
        Array.from({ length: result.length }, (_, index) =>
          result[index]?.transcript.trim(),
        ).filter((transcript): transcript is string => Boolean(transcript)),
      );
      const interpretation = transcripts
        .map((transcript) => {
          if (isVoiceOptionsCommand(transcript)) {
            return { type: "options" as const };
          }

          const notation = matchSpokenMove(transcript, legalNotations);
          return notation ? { type: "move" as const, notation } : null;
        })
        .find(
          (
            candidate,
          ): candidate is
            | { readonly type: "options" }
            | { readonly type: "move"; readonly notation: string } =>
            candidate !== null,
        );

      if (interpretation?.type === "options") {
        const runId = optionsRunRef.current + 1;
        optionsRunRef.current = runId;
        const count = legalNotations.length;
        const countLabel = `${count} legal ${count === 1 ? "move" : "moves"}`;
        setPhase("reading-options");
        setFeedback(`Reading ${countLabel}…`);

        void onOptions()
          .then((result) => {
            if (!mountedRef.current || optionsRunRef.current !== runId) return;
            setPhase("idle");

            if (result === "unavailable") {
              setFeedback(
                "Speech playback is unavailable. Your legal moves were sent to the screen reader.",
              );
              return;
            }

            if (result === "cancelled") {
              setFeedback("Options readout stopped.");
              return;
            }

            const completion = `Read ${countLabel}.`;
            setFeedback(completion);
            onAnnounce(completion);
          })
          .catch((error: unknown) => {
            if (!mountedRef.current || optionsRunRef.current !== runId) return;
            const detail = error instanceof Error ? error.message : String(error);
            const retry = `Options could not be read. ${detail}`;
            setPhase("idle");
            setFeedback(retry);
            onAnnounce(retry);
          });
        return;
      }

      if (interpretation?.type !== "move") {
        const heard = transcripts[0] ? `I heard “${transcripts[0]}.” ` : "";
        const retry = `${heard}That is not a current legal move. ${instruction}`;
        setPhase("idle");
        setFeedback(retry);
        onAnnounce(retry);
        return;
      }

      const match = interpretation.notation;
      setPhase("submitting");
      setFeedback(`Playing ${match}…`);
      void onMove(match)
        .then(() => {
          if (!mountedRef.current) return;
          setPhase("idle");
          setFeedback(`Played ${match}.`);
        })
        .catch((error: unknown) => {
          if (!mountedRef.current) return;
          const detail = error instanceof Error ? error.message : String(error);
          const retry = `That move could not be played. ${detail}`;
          setPhase("idle");
          setFeedback(retry);
          onAnnounce(retry);
        });
    };

    recognition.onerror = (event) => {
      if (!mountedRef.current) return;
      handled = true;
      recognitionRef.current = null;
      const message = recognitionError(event.error, instruction);
      setPhase("idle");
      setFeedback(message);
      if (event.error !== "aborted") {
        onAnnounce(message);
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (!mountedRef.current || handled) return;
      const retry = `No command was heard. ${instruction}`;
      setPhase("idle");
      setFeedback(retry);
      onAnnounce(retry);
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      const message = "The microphone could not start. Try again or use your agent.";
      setPhase("idle");
      setFeedback(message);
      onAnnounce(message);
    }
  };

  const buttonLabel =
    supported === false
      ? "Mic unavailable"
      : phase === "listening"
        ? "Stop listening"
        : phase === "reading-options"
          ? "Stop reading options"
        : phase === "requesting"
          ? "Waiting for mic…"
        : phase === "submitting"
          ? "Playing move…"
          : "Speak Black move";

  if (!showUnavailable && supported !== true) {
    return null;
  }

  return (
    <div className="black-voice-control" data-phase={phase}>
      <button
        aria-disabled={locked || undefined}
        aria-describedby="black-voice-feedback"
        aria-pressed={listening || readingOptions}
        disabled={unavailable}
        onClick={beginListening}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 15.25a3.25 3.25 0 0 0 3.25-3.25V7a3.25 3.25 0 0 0-6.5 0v5A3.25 3.25 0 0 0 12 15.25Zm-5-3.5a.75.75 0 0 0-1.5 0 6.5 6.5 0 0 0 5.75 6.46v1.29H9a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5h-2.25v-1.29a6.5 6.5 0 0 0 5.75-6.46.75.75 0 0 0-1.5 0 5 5 0 0 1-10 0Z" />
        </svg>
        {buttonLabel}
      </button>
      <p id="black-voice-feedback">{message}</p>
    </div>
  );
}

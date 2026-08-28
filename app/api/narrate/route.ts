import {
  isNarrationSessionId,
  isNarrationText,
  normalizeNarrationText,
} from "@/lib/narration";

const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const MAX_UNCACHED_CALLS_PER_SESSION = 60;
const MAX_CACHE_ENTRIES = 128;
const MAX_TRACKED_SESSIONS = 1_000;
const MAX_AUDIO_BYTES = 2_000_000;

interface CachedAudio {
  bytes: ArrayBuffer;
  contentType: string;
}

const audioCache = new Map<string, CachedAudio>();
const pendingAudio = new Map<string, Promise<CachedAudio | null>>();
const sessionCalls = new Map<string, number>();

function fallbackResponse(status = 200): Response {
  return Response.json(
    { fallback: true },
    {
      headers: { "Cache-Control": "no-store" },
      status,
    },
  );
}

function audioResponse(audio: CachedAudio, cache: "hit" | "miss"): Response {
  return new Response(audio.bytes.slice(0), {
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Type": audio.contentType,
      "X-Boardspeak-AI-Generated": "true",
      "X-Boardspeak-Narration-Cache": cache,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function parsePayload(
  payload: unknown,
): { sessionId: string; text: string } | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }

  const candidate = payload as Record<string, unknown>;

  if (
    !isNarrationText(candidate.text) ||
    !isNarrationSessionId(candidate.sessionId)
  ) {
    return null;
  }

  return {
    sessionId: candidate.sessionId,
    text: normalizeNarrationText(candidate.text),
  };
}

function recordUncachedCall(sessionId: string): boolean {
  const current = sessionCalls.get(sessionId) ?? 0;

  if (current >= MAX_UNCACHED_CALLS_PER_SESSION) {
    return false;
  }

  if (!sessionCalls.has(sessionId) && sessionCalls.size >= MAX_TRACKED_SESSIONS) {
    const oldestSession = sessionCalls.keys().next().value;

    if (oldestSession) {
      sessionCalls.delete(oldestSession);
    }
  }

  sessionCalls.set(sessionId, current + 1);
  return true;
}

function storeAudio(text: string, audio: CachedAudio): void {
  if (audioCache.size >= MAX_CACHE_ENTRIES) {
    const oldestPhrase = audioCache.keys().next().value;

    if (oldestPhrase) {
      audioCache.delete(oldestPhrase);
    }
  }

  audioCache.set(text, audio);
}

async function requestSpeech(
  apiKey: string,
  text: string,
): Promise<CachedAudio | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(OPENAI_SPEECH_URL, {
      body: JSON.stringify({
        input: text,
        instructions:
          "Speak this board-game update warmly, clearly, and in about one second.",
        model: "gpt-4o-mini-tts",
        response_format: "mp3",
        voice: "marin",
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type")?.split(";")[0];

    if (!contentType?.startsWith("audio/")) {
      return null;
    }

    const bytes = await response.arrayBuffer();

    if (bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) {
      return null;
    }

    return { bytes, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return fallbackResponse(400);
  }

  const parsed = parsePayload(payload);

  if (!parsed) {
    return fallbackResponse(400);
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return fallbackResponse();
  }

  const cached = audioCache.get(parsed.text);

  if (cached) {
    return audioResponse(cached, "hit");
  }

  const pending = pendingAudio.get(parsed.text);

  if (pending) {
    const audio = await pending;
    return audio ? audioResponse(audio, "hit") : fallbackResponse();
  }

  if (!recordUncachedCall(parsed.sessionId)) {
    return fallbackResponse();
  }

  const requestPromise = requestSpeech(apiKey, parsed.text);
  pendingAudio.set(parsed.text, requestPromise);

  try {
    const audio = await requestPromise;

    if (!audio) {
      return fallbackResponse();
    }

    storeAudio(parsed.text, audio);
    return audioResponse(audio, "miss");
  } finally {
    pendingAudio.delete(parsed.text);
  }
}

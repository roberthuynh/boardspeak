const NUMBER_WORDS: Readonly<Record<string, string>> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
};

const FILE_WORDS: Readonly<Record<string, string>> = {
  ay: "a",
  bee: "b",
  be: "b",
  sea: "c",
  see: "c",
  dee: "d",
  ee: "e",
  eff: "f",
  gee: "g",
  aitch: "h",
};

function spokenCoordinates(transcript: string): string[] {
  const normalized = transcript
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => NUMBER_WORDS[token] ?? FILE_WORDS[token] ?? token)
    .join(" ");

  return [...normalized.matchAll(/\b([a-h])\s*([1-8])\b/g)].map(
    ([, file, rank]) => `${file}${rank}`,
  );
}

export function matchSpokenMove(
  transcript: string,
  legalNotations: readonly string[],
): string | null {
  const coordinates = spokenCoordinates(transcript);
  if (coordinates.length !== 2) {
    return null;
  }
  const [from, to] = coordinates;

  const matches = legalNotations.filter((notation) => {
    const coordinates = notation.match(/[a-h][1-8]/g);
    return coordinates?.[0] === from && coordinates[1] === to;
  });

  return matches.length === 1 ? matches[0]! : null;
}

export function spokenMoveExample(notation: string): string {
  return notation.includes("x")
    ? notation.replace("x", " takes ")
    : notation.replace("-", " to ");
}

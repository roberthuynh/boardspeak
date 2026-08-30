import { describe, expect, it } from "vitest";
import { matchSpokenMove, spokenMoveExample } from "@/lib/voice-input";

describe("Black voice move matching", () => {
  it("matches spoken advances and captures against the supplied live enum", () => {
    const legal = ["e7-e6", "e7xd6"];

    expect(matchSpokenMove("e seven to e six", legal)).toBe("e7-e6");
    expect(matchSpokenMove("E7 takes D6", legal)).toBe("e7xd6");
    expect(matchSpokenMove("ee seven to ee six", legal)).toBe("e7-e6");
    expect(spokenMoveExample("e7xd6")).toBe("e7 takes d6");
  });

  it("rejects partial, illegal, and ambiguous speech", () => {
    expect(matchSpokenMove("move e7", ["e7-e6"])).toBeNull();
    expect(matchSpokenMove("d7 to d6", ["e7-e6"])).toBeNull();
    expect(
      matchSpokenMove("e7 to e6 or d7 to d6", ["e7-e6", "d7-d6"]),
    ).toBeNull();
  });
});

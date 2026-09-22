import { describe, expect, it } from "vitest";
import { getCodexWindowKind } from "../../open-sse/services/usage/codex.js";

describe("Codex quota window classification", () => {
  it("uses the provider duration when the weekly limit is returned as primary", () => {
    expect(getCodexWindowKind({ limit_window_seconds: 604800 }, "session")).toBe("weekly");
    expect(getCodexWindowKind({ limit_window_seconds: 18000 }, "weekly")).toBe("session");
  });

  it("keeps the positional fallback when the provider omits duration", () => {
    expect(getCodexWindowKind({}, "session")).toBe("session");
    expect(getCodexWindowKind({}, "weekly")).toBe("weekly");
  });
});

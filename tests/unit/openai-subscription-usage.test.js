import { describe, expect, it } from "vitest";
import {
  calculateOpenAISubscriptionUsage,
  getOpenAISubscriptionTier,
} from "../../src/shared/utils/openaiSubscriptionUsage.js";

describe("OpenAI subscription usage", () => {
  it("calculates non-cached, cached, and output credits with the official model rates", () => {
    const result = calculateOpenAISubscriptionUsage("gpt-5.6-sol", {
      promptTokens: 2_000_000,
      cachedTokens: 1_000_000,
      completionTokens: 1_000_000,
    }, "plus");

    expect(result.credits).toBe(610);
    expect(result.percent).toBe(122);
  });

  it("uses the selected plan multiplier and supports review model variants", () => {
    const result = calculateOpenAISubscriptionUsage("gpt-5.6-sol-review", {
      promptTokens: 1_000_000,
      completionTokens: 0,
    }, "pro20x");

    expect(result.percent).toBe(1);
    expect(getOpenAISubscriptionTier("pro5x").estimatedWeeklyCredits).toBe(2500);
  });

  it("uses the GPT-5.4 rate for the Codex auto-review virtual model", () => {
    const result = calculateOpenAISubscriptionUsage("codex-auto-review", {
      promptTokens: 1_000_000,
      completionTokens: 0,
    }, "plus");

    expect(result.credits).toBe(62.5);
    expect(result.percent).toBe(12.5);
  });

  it("does not estimate models missing from the official rate card", () => {
    expect(calculateOpenAISubscriptionUsage("gpt-5.3-codex-spark", {}, "plus")).toBeNull();
  });
});

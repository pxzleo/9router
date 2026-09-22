import { describe, expect, it } from "vitest";
import {
  addOpenAISubscriptionUsage,
  calculateCalibrationSample,
  calculateOpenAICredits,
  getCalibratedWeeklyCredits,
} from "../../src/shared/utils/openaiSubscriptionUsage.js";

describe("OpenAI subscription usage", () => {
  it("calculates non-cached, cached, and output credits with the official model rates", () => {
    expect(calculateOpenAICredits("gpt-5.6-sol", {
      promptTokens: 2_000_000,
      cachedTokens: 1_000_000,
      completionTokens: 1_000_000,
    })).toBe(610);
  });

  it("supports review variants and the Codex auto-review virtual model", () => {
    expect(calculateOpenAICredits("gpt-5.6-sol-review", { promptTokens: 1_000_000 })).toBe(100);
    expect(calculateOpenAICredits("codex-auto-review", { promptTokens: 1_000_000 })).toBe(62.5);
  });

  it("does not estimate models missing from the official rate card", () => {
    expect(calculateOpenAICredits("gpt-5.3-codex-spark", {})).toBeNull();
  });

  it("derives a weekly capacity and rounding interval from two real snapshots", () => {
    const sample = calculateCalibrationSample(
      { usedPercent: 6, localCredits: 100 },
      { usedPercent: 11, localCredits: 1100 },
    );
    expect(sample.weeklyCredits).toBe(20_000);
    expect(sample.minWeeklyCredits).toBeCloseTo(16_666.67, 1);
    expect(sample.maxWeeklyCredits).toBe(25_000);
  });

  it("rejects calibration before the official meter moves five points", () => {
    expect(() => calculateCalibrationSample(
      { usedPercent: 6, localCredits: 100 },
      { usedPercent: 10, localCredits: 900 },
    )).toThrow("至少增长 5 个百分点");
  });

  it("uses the median of completed calibration samples", () => {
    expect(getCalibratedWeeklyCredits({
      samples: [{ weeklyCredits: 20_000 }, { weeklyCredits: 40_000 }, { weeklyCredits: 30_000 }],
    })).toBe(30_000);
  });

  it("calculates each row from per-account calibrated credits", () => {
    const rows = addOpenAISubscriptionUsage({
      codex: {
        providerId: "codex",
        rawModel: "gpt-5.6-sol",
        subscriptionCreditsByConnection: { accountA: 300, accountB: 200 },
      },
      local: { providerId: "local", rawModel: "qwen" },
    }, {
      accountA: { samples: [{ weeklyCredits: 20_000 }] },
      accountB: { samples: [{ weeklyCredits: 10_000 }] },
    });

    expect(rows.codex.subscriptionPercent).toBeCloseTo(3.5);
    expect(rows.codex.subscriptionCredits).toBe(500);
    expect(rows.local.subscriptionPercent).toBeNull();
  });

  it("does not show a partial percentage when one contributing account is uncalibrated", () => {
    const rows = addOpenAISubscriptionUsage({
      codex: {
        providerId: "codex",
        rawModel: "gpt-5.6-sol",
        subscriptionCreditsByConnection: { calibrated: 100, missing: 100 },
      },
    }, { calibrated: { samples: [{ weeklyCredits: 10_000 }] } });

    expect(rows.codex.subscriptionPercent).toBeNull();
  });
});

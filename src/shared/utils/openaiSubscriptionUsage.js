// Credits per one million tokens from OpenAI's current Codex rate card.
const MODEL_CREDIT_RATES = {
  "gpt-6-astra": { input: 250, cachedInput: 25, output: 1250 },
  "gpt-5.6-sol": { input: 100, cachedInput: 10, output: 500 },
  "gpt-5.6-terra": { input: 50, cachedInput: 5, output: 300 },
  "gpt-5.6-luna": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.5": { input: 125, cachedInput: 12.5, output: 750 },
  "gpt-5.4": { input: 62.5, cachedInput: 6.25, output: 375 },
  "gpt-5.4-mini": { input: 18.75, cachedInput: 1.875, output: 113 },
};

function normalizeModel(model) {
  const normalized = String(model || "").toLowerCase();
  if (normalized === "codex-auto-review") return "gpt-5.4";
  return normalized.replace(/-review$/, "");
}

export function calculateOpenAICredits(model, tokens) {
  const rates = MODEL_CREDIT_RATES[normalizeModel(model)];
  if (!rates) return null;

  const promptTokens = Math.max(0, Number(tokens?.promptTokens) || 0);
  const cachedTokens = Math.min(promptTokens, Math.max(0, Number(tokens?.cachedTokens) || 0));
  const completionTokens = Math.max(0, Number(tokens?.completionTokens) || 0);
  const inputTokens = promptTokens - cachedTokens;
  return (
    inputTokens * rates.input +
    cachedTokens * rates.cachedInput +
    completionTokens * rates.output
  ) / 1_000_000;
}

export function calculateCalibrationSample(start, end) {
  const startPercent = Number(start?.usedPercent);
  const endPercent = Number(end?.usedPercent);
  const startCredits = Number(start?.localCredits);
  const endCredits = Number(end?.localCredits);
  const percentDelta = endPercent - startPercent;
  const creditsDelta = endCredits - startCredits;

  if (!Number.isFinite(percentDelta) || percentDelta < 5) {
    throw new RangeError("官方周用量至少增长 5 个百分点后才能完成校准");
  }
  if (!Number.isFinite(creditsDelta) || creditsDelta <= 0) {
    throw new RangeError("校准期间没有记录到可计费的 OpenAI Token");
  }

  const weeklyCredits = creditsDelta / (percentDelta / 100);
  const minPercentDelta = Math.max(0.01, percentDelta - 1);
  const maxPercentDelta = percentDelta + 1;
  return {
    percentDelta,
    creditsDelta,
    weeklyCredits,
    minWeeklyCredits: creditsDelta / (maxPercentDelta / 100),
    maxWeeklyCredits: creditsDelta / (minPercentDelta / 100),
  };
}

export function getCalibratedWeeklyCredits(calibration) {
  const values = (calibration?.samples || [])
    .map((sample) => Number(sample.weeklyCredits))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

export function addOpenAISubscriptionUsage(dataMap, calibrations = {}) {
  return Object.fromEntries(Object.entries(dataMap || {}).map(([key, data]) => {
    if (data.providerId !== "codex") {
      return [key, { ...data, subscriptionPercent: null }];
    }

    const creditsByConnection = data.subscriptionCreditsByConnection || {};
    const entries = Object.entries(creditsByConnection).filter(([, credits]) => Number(credits) > 0);
    if (!entries.length && data.connectionId) {
      const credits = calculateOpenAICredits(data.rawModel, data);
      if (credits != null && credits > 0) entries.push([data.connectionId, credits]);
    }

    let percent = 0;
    let totalCredits = 0;
    for (const [connectionId, rawCredits] of entries) {
      const credits = Number(rawCredits);
      const weeklyCredits = getCalibratedWeeklyCredits(calibrations[connectionId]);
      if (!weeklyCredits) {
        return [key, { ...data, subscriptionPercent: null, subscriptionCredits: totalCredits + credits }];
      }
      totalCredits += credits;
      percent += credits / weeklyCredits * 100;
    }

    return [key, entries.length
      ? { ...data, subscriptionPercent: percent, subscriptionCredits: totalCredits }
      : { ...data, subscriptionPercent: null }];
  }));
}

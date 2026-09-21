// OpenAI publishes the 5x/20x plan multipliers, but not a fixed personal-plan
// credit pool. These rolling-week budgets are estimates and the UI labels them as such.
export const OPENAI_SUBSCRIPTION_TIERS = [
  { value: "plus", label: "Plus", estimatedWeeklyCredits: 500 },
  { value: "pro5x", label: "Pro 5x", estimatedWeeklyCredits: 2500 },
  { value: "pro20x", label: "Pro 20x", estimatedWeeklyCredits: 10000 },
];

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

export function getOpenAISubscriptionTier(value) {
  return OPENAI_SUBSCRIPTION_TIERS.find((tier) => tier.value === value) || OPENAI_SUBSCRIPTION_TIERS[0];
}

export function calculateOpenAISubscriptionUsage(model, tokens, tierValue) {
  const rates = MODEL_CREDIT_RATES[normalizeModel(model)];
  if (!rates) return null;

  const promptTokens = Math.max(0, Number(tokens?.promptTokens) || 0);
  const cachedTokens = Math.min(promptTokens, Math.max(0, Number(tokens?.cachedTokens) || 0));
  const completionTokens = Math.max(0, Number(tokens?.completionTokens) || 0);
  const inputTokens = promptTokens - cachedTokens;
  const credits = (
    inputTokens * rates.input +
    cachedTokens * rates.cachedInput +
    completionTokens * rates.output
  ) / 1_000_000;
  const tier = getOpenAISubscriptionTier(tierValue);

  return {
    credits,
    percent: tier.estimatedWeeklyCredits > 0 ? credits / tier.estimatedWeeklyCredits * 100 : 0,
  };
}

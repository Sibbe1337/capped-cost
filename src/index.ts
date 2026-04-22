/**
 * capped-cost — fetch monthly OpenAI and Anthropic API spend.
 *
 * Read-only admin keys only. Zero dependencies. Returns a normalized shape
 * (daily breakdown + monthly total in cents) so you can build dashboards,
 * alerts, or budgets on top.
 *
 * Built alongside Capped (https://getcapped.app).
 */

export { fetchOpenAICost } from "./openai.js";
export { fetchAnthropicCost } from "./anthropic.js";
export { fetchAllCosts } from "./combined.js";
export {
  fetchOpenAICostBreakdown,
  fetchAnthropicCostBreakdown,
  fetchAllBreakdowns,
} from "./breakdown.js";
export { forecast } from "./forecast.js";
export { evaluateAlert, normalizeThresholds } from "./alert.js";
export {
  explainOpenAIError,
  explainAnthropicError,
  formatErrorForTerminal,
} from "./errors.js";
export type {
  CostResult,
  CostError,
  ProviderCostResult,
  CombinedCostResult,
  FetchOptions,
} from "./types.js";
export type {
  BreakdownResult,
  BreakdownError,
  BreakdownOutcome,
  CombinedBreakdown,
} from "./breakdown.js";
export type { ForecastInput, ForecastResult, ForecastStrategy } from "./forecast.js";
export type {
  AlertCommandStatus,
  AlertEvaluationInput,
  AlertEvaluationResult,
  AlertState,
  AlertThresholdState,
  AlertTriggerReason,
} from "./alert.js";
export type { ExplainedError } from "./errors.js";

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
export type {
  CostResult,
  CostError,
  ProviderCostResult,
  CombinedCostResult,
  FetchOptions,
} from "./types.js";

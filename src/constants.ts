export const JSON_SCHEMA_VERSION = 1;

export const DEFAULT_CHECK_THRESHOLD = 0.8;
export const DEFAULT_ALERT_THRESHOLDS = [0.8, 1, 1.5] as const;
export const DEFAULT_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_STATE_FILE = ".capped-cost.state.json";
export const DEFAULT_SECRETS_FILE = ".env.capped.local";

export type OutputFormat = "table" | "json";
export type ProviderName = "openai" | "anthropic";
export type ProviderSelector = ProviderName | "all";

export const EXIT_CODES = {
  ok: 0,
  config: 1,
  provider: 2,
  webhook: 3,
  threshold: 2,
  internal: 10,
} as const;

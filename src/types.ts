/**
 * Normalized cost shape. Cents are used throughout to avoid
 * floating-point drift when summing across days and providers.
 */
export interface CostResult {
  /** Per-day cost totals, keyed by ISO YYYY-MM-DD (UTC). */
  dailyCents: Map<string, number>;
  /** Total cost for the requested period, in cents. */
  totalCents: number;
}

export interface CostError {
  error: string;
  /** Optional human-readable guidance on common causes + fixes. */
  hint?: string[];
}

export type ProviderCostResult = CostResult | CostError;

export interface CombinedCostResult {
  /** Individual provider results (may include errors). */
  providers: {
    openai?: ProviderCostResult;
    anthropic?: ProviderCostResult;
  };
  /** Combined daily totals across all providers that succeeded. */
  dailyCents: Map<string, number>;
  /** Combined monthly total across all providers that succeeded, in cents. */
  totalCents: number;
}

export interface FetchOptions {
  /**
   * Custom fetch implementation. Defaults to globalThis.fetch (available
   * in Node 18+, Bun, Deno, and every modern browser).
   */
  fetch?: typeof globalThis.fetch;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

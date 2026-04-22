import type {
  CombinedCostResult,
  FetchOptions,
  ProviderCostResult,
} from "./types.js";
import { fetchOpenAICost } from "./openai.js";
import { fetchAnthropicCost } from "./anthropic.js";

export interface AllKeys {
  openai?: string;
  anthropic?: string;
}

function isCostResult(
  r: ProviderCostResult
): r is { dailyCents: Map<string, number>; totalCents: number } {
  return (r as { error?: string }).error === undefined;
}

/**
 * Fetch current-month costs from every provider for which a key is
 * supplied. Provider calls run in parallel. Returns per-provider results
 * (including errors) plus combined totals across providers that succeeded.
 *
 * @param keys     Admin keys, one per provider. Omit any you don't track.
 * @param options  Optional custom fetch + abort signal
 */
export async function fetchAllCosts(
  keys: AllKeys,
  options: FetchOptions = {}
): Promise<CombinedCostResult> {
  const tasks: Array<Promise<void>> = [];
  const providers: CombinedCostResult["providers"] = {};

  if (keys.openai) {
    tasks.push(
      fetchOpenAICost(keys.openai, options).then((r) => {
        providers.openai = r;
      })
    );
  }

  if (keys.anthropic) {
    tasks.push(
      fetchAnthropicCost(keys.anthropic, options).then((r) => {
        providers.anthropic = r;
      })
    );
  }

  await Promise.all(tasks);

  const dailyCents = new Map<string, number>();
  let totalCents = 0;

  for (const key of ["openai", "anthropic"] as const) {
    const r = providers[key];
    if (!r || !isCostResult(r)) continue;
    totalCents += r.totalCents;
    for (const [day, cents] of r.dailyCents) {
      dailyCents.set(day, (dailyCents.get(day) || 0) + cents);
    }
  }

  return { providers, dailyCents, totalCents };
}

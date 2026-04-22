import type { ProviderSelector } from "./constants.js";

export function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export function formatPct(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatThresholdLabel(threshold: number): string {
  const pct = threshold * 100;
  const digits = Number.isInteger(pct) ? 0 : Number.isInteger(pct * 10) ? 1 : 2;
  return formatPct(threshold, digits);
}

export function bar(ratio: number): string {
  const width = 12;
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width);
  return "█".repeat(filled).padEnd(width, "░");
}

export function providerNames(provider: ProviderSelector): Array<"openai" | "anthropic"> {
  if (provider === "openai" || provider === "anthropic") return [provider];
  return ["openai", "anthropic"];
}

export function sortedEntries<V>(map: Map<string, V>): Array<[string, V]> {
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

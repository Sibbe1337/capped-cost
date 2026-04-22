/**
 * Internal time helpers. Always UTC. Day keys are ISO YYYY-MM-DD.
 */

export function startOfMonthUnix(now: Date = new Date()): number {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  return Math.floor(d.getTime() / 1000);
}

export function startOfMonthIso(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();
}

export function dayKeyFromUnix(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function dayKeyFromIso(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

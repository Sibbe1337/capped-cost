import { JSON_SCHEMA_VERSION, DEFAULT_ALERT_COOLDOWN_MS, DEFAULT_ALERT_THRESHOLDS } from "./constants.js";

export type AlertCommandStatus =
  | "under-threshold"
  | "threshold-reached"
  | "threshold-crossed";

export type AlertTriggerReason = "crossed" | "cooldown";

export interface AlertThresholdState {
  lastAlertAt?: string;
  lastAlertStatus?: AlertCommandStatus;
  lastAlertUsd?: number;
}

export interface AlertState {
  schemaVersion: number;
  month: string;
  lastObservedPct: number;
  thresholds: Record<string, AlertThresholdState>;
  updatedAt: string;
}

export interface AlertEvaluationInput {
  capUsd: number;
  cooldownMs?: number;
  now?: Date;
  previousState?: AlertState | null;
  thresholds?: number[];
  totalCents: number;
}

export interface AlertEvaluationResult {
  activeThresholds: number[];
  capUsd: number;
  cooldownMs: number;
  pctUsed: number;
  previousPctUsed: number;
  schemaVersion: number;
  shouldAlert: boolean;
  state: AlertState;
  status: AlertCommandStatus;
  threshold?: number;
  totalUsd: number;
  triggerReason?: AlertTriggerReason;
}

export function normalizeThresholds(values: number[] = Array.from(DEFAULT_ALERT_THRESHOLDS)): number[] {
  return Array.from(
    new Set(
      values
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Number(value.toFixed(6)))
    )
  ).sort((a, b) => a - b);
}

function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function blankState(now: Date): AlertState {
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    month: monthKey(now),
    lastObservedPct: 0,
    thresholds: {},
    updatedAt: now.toISOString(),
  };
}

function getThresholdKey(value: number): string {
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

export function evaluateAlert(input: AlertEvaluationInput): AlertEvaluationResult {
  const now = input.now ?? new Date();
  const thresholds = normalizeThresholds(input.thresholds);
  const totalUsd = input.totalCents / 100;
  const pctUsed = totalUsd / input.capUsd;
  const cooldownMs = input.cooldownMs ?? DEFAULT_ALERT_COOLDOWN_MS;

  const previous =
    input.previousState &&
    input.previousState.schemaVersion === JSON_SCHEMA_VERSION &&
    input.previousState.month === monthKey(now)
      ? input.previousState
      : blankState(now);

  const previousPctUsed = previous.lastObservedPct || 0;
  const activeThresholds = thresholds.filter((threshold) => pctUsed >= threshold);
  const nextState: AlertState = {
    schemaVersion: JSON_SCHEMA_VERSION,
    month: monthKey(now),
    lastObservedPct: pctUsed,
    thresholds: { ...previous.thresholds },
    updatedAt: now.toISOString(),
  };

  if (!activeThresholds.length) {
    return {
      activeThresholds,
      capUsd: input.capUsd,
      cooldownMs,
      pctUsed,
      previousPctUsed,
      schemaVersion: JSON_SCHEMA_VERSION,
      shouldAlert: false,
      state: nextState,
      status: "under-threshold",
      totalUsd,
    };
  }

  const crossed = [...activeThresholds]
    .reverse()
    .find((threshold) => previousPctUsed < threshold);
  if (crossed !== undefined) {
    const key = getThresholdKey(crossed);
    nextState.thresholds[key] = {
      lastAlertAt: now.toISOString(),
      lastAlertStatus: "threshold-crossed",
      lastAlertUsd: totalUsd,
    };
    return {
      activeThresholds,
      capUsd: input.capUsd,
      cooldownMs,
      pctUsed,
      previousPctUsed,
      schemaVersion: JSON_SCHEMA_VERSION,
      shouldAlert: true,
      state: nextState,
      status: "threshold-crossed",
      threshold: crossed,
      totalUsd,
      triggerReason: "crossed",
    };
  }

  const highest = activeThresholds[activeThresholds.length - 1];
  const key = getThresholdKey(highest);
  const thresholdState = previous.thresholds[key];
  const lastAlertAt = thresholdState?.lastAlertAt ? Date.parse(thresholdState.lastAlertAt) : NaN;
  const cooldownExpired =
    !Number.isFinite(lastAlertAt) || now.getTime() - lastAlertAt >= cooldownMs;

  if (cooldownExpired) {
    nextState.thresholds[key] = {
      lastAlertAt: now.toISOString(),
      lastAlertStatus: "threshold-reached",
      lastAlertUsd: totalUsd,
    };
  }

  return {
    activeThresholds,
    capUsd: input.capUsd,
    cooldownMs,
    pctUsed,
    previousPctUsed,
    schemaVersion: JSON_SCHEMA_VERSION,
    shouldAlert: cooldownExpired,
    state: nextState,
    status: "threshold-reached",
    threshold: highest,
    totalUsd,
    triggerReason: cooldownExpired ? "cooldown" : undefined,
  };
}

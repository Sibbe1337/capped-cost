import { describe, expect, it } from "vitest";

import { evaluateAlert } from "../src/alert.js";

describe("evaluateAlert", () => {
  it("alerts on a fresh threshold crossing", () => {
    const result = evaluateAlert({
      capUsd: 100,
      now: new Date(Date.UTC(2026, 3, 10, 12, 0, 0)),
      previousState: {
        month: "2026-04",
        lastObservedPct: 0.6,
        schemaVersion: 1,
        thresholds: {},
        updatedAt: "2026-04-10T10:00:00.000Z",
      },
      thresholds: [0.8, 1],
      totalCents: 8500,
    });

    expect(result.shouldAlert).toBe(true);
    expect(result.status).toBe("threshold-crossed");
    expect(result.threshold).toBe(0.8);
    expect(result.triggerReason).toBe("crossed");
  });

  it("dedupes repeated runs until cooldown expires", () => {
    const first = evaluateAlert({
      capUsd: 100,
      now: new Date(Date.UTC(2026, 3, 10, 12, 0, 0)),
      thresholds: [0.8],
      totalCents: 8500,
    });
    const second = evaluateAlert({
      capUsd: 100,
      now: new Date(Date.UTC(2026, 3, 10, 13, 0, 0)),
      previousState: first.state,
      thresholds: [0.8],
      totalCents: 8600,
    });
    const third = evaluateAlert({
      capUsd: 100,
      cooldownMs: 60 * 60 * 1000,
      now: new Date(Date.UTC(2026, 3, 10, 14, 5, 0)),
      previousState: first.state,
      thresholds: [0.8],
      totalCents: 8700,
    });

    expect(second.shouldAlert).toBe(false);
    expect(second.status).toBe("threshold-reached");
    expect(third.shouldAlert).toBe(true);
    expect(third.status).toBe("threshold-reached");
    expect(third.triggerReason).toBe("cooldown");
  });

  it("resets dedupe state on a new month", () => {
    const result = evaluateAlert({
      capUsd: 100,
      now: new Date(Date.UTC(2026, 4, 1, 8, 0, 0)),
      previousState: {
        month: "2026-04",
        lastObservedPct: 1.2,
        schemaVersion: 1,
        thresholds: {
          "0.8": { lastAlertAt: "2026-04-30T12:00:00.000Z" },
        },
        updatedAt: "2026-04-30T12:00:00.000Z",
      },
      thresholds: [0.8],
      totalCents: 8100,
    });

    expect(result.shouldAlert).toBe(true);
    expect(result.triggerReason).toBe("crossed");
    expect(result.state.month).toBe("2026-05");
  });
});

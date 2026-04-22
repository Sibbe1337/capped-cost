import { describe, it, expect } from "vitest";
import { forecast } from "../src/forecast.js";

describe("forecast", () => {
  it("extrapolates month-end spend from current run rate", () => {
    // Day 10 of a 30-day month, $300 spent → $900 projected EOM
    const now = new Date(Date.UTC(2026, 3, 10, 12, 0, 0)); // April 10 = 30 days
    const r = forecast({ totalCents: 30000, now });
    expect(r.dayOfMonth).toBe(10);
    expect(r.daysInMonth).toBe(30);
    expect(r.totalUsd).toBe(300);
    expect(r.dailyAvgUsd).toBe(30);
    expect(r.projectedEomUsd).toBe(900);
  });

  it("marks status over when projected > cap", () => {
    const now = new Date(Date.UTC(2026, 3, 10, 12, 0, 0));
    const r = forecast({ totalCents: 30000, capUsd: 500, now });
    expect(r.status).toBe("over");
    expect(r.overCapUsd).toBe(400);
    expect(r.projectedPctOfCap).toBeCloseTo(1.8, 4);
  });

  it("marks status on-pace when 90%+ of cap", () => {
    // Projected $550 vs $600 cap = 91.6%
    const now = new Date(Date.UTC(2026, 3, 10, 12, 0, 0));
    const r = forecast({ totalCents: 18333, capUsd: 600, now });
    expect(r.status).toBe("on-pace");
    expect(r.overCapUsd).toBe(0);
  });

  it("marks status under when comfortably below cap", () => {
    const now = new Date(Date.UTC(2026, 3, 10, 12, 0, 0));
    const r = forecast({ totalCents: 5000, capUsd: 500, now });
    expect(r.status).toBe("under");
    expect(r.overCapUsd).toBe(0);
  });

  it("handles February 2026 (28 days)", () => {
    const now = new Date(Date.UTC(2026, 1, 14, 0, 0, 0)); // Feb 14
    const r = forecast({ totalCents: 14000, now });
    expect(r.dayOfMonth).toBe(14);
    expect(r.daysInMonth).toBe(28);
    expect(r.projectedEomUsd).toBe(280);
  });

  it("omits cap fields when capUsd is not provided", () => {
    const now = new Date(Date.UTC(2026, 3, 10, 12, 0, 0));
    const r = forecast({ totalCents: 30000, now });
    expect(r.projectedPctOfCap).toBeUndefined();
    expect(r.overCapUsd).toBeUndefined();
    expect(r.status).toBe("under");
  });
});

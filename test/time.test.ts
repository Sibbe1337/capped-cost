import { describe, it, expect } from "vitest";
import {
  startOfMonthUnix,
  startOfMonthIso,
  dayKeyFromUnix,
  dayKeyFromIso,
} from "../src/time.js";

describe("time helpers", () => {
  it("startOfMonthUnix returns the unix timestamp for the first of the month in UTC", () => {
    const apr15 = new Date(Date.UTC(2026, 3, 15, 10, 30, 0));
    const expected = Math.floor(Date.UTC(2026, 3, 1) / 1000);
    expect(startOfMonthUnix(apr15)).toBe(expected);
  });

  it("startOfMonthIso returns ISO string for first of month UTC", () => {
    const apr15 = new Date(Date.UTC(2026, 3, 15, 10, 30, 0));
    expect(startOfMonthIso(apr15)).toBe("2026-04-01T00:00:00.000Z");
  });

  it("dayKeyFromUnix returns YYYY-MM-DD", () => {
    // 2026-04-15 14:30 UTC
    const unix = Math.floor(Date.UTC(2026, 3, 15, 14, 30) / 1000);
    expect(dayKeyFromUnix(unix)).toBe("2026-04-15");
  });

  it("dayKeyFromIso returns YYYY-MM-DD", () => {
    expect(dayKeyFromIso("2026-04-15T14:30:00.000Z")).toBe("2026-04-15");
  });

  it("dayKeyFromUnix is UTC (not timezone-dependent)", () => {
    // Late on Apr 15 UTC = early Apr 16 for eastern timezones.
    const unix = Math.floor(Date.UTC(2026, 3, 15, 23, 30) / 1000);
    expect(dayKeyFromUnix(unix)).toBe("2026-04-15");
  });
});

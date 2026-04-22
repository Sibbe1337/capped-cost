import { describe, it, expect } from "vitest";
import {
  explainOpenAIError,
  explainAnthropicError,
  formatErrorForTerminal,
} from "../src/errors.js";

describe("explainOpenAIError", () => {
  it("adds admin-key hint on 401", () => {
    const e = explainOpenAIError(401, "Invalid authentication");
    expect(e.hint).toBeDefined();
    expect(e.hint!.some((h) => h.includes("admin"))).toBe(true);
  });

  it("adds permission hint on 403", () => {
    const e = explainOpenAIError(403, "Forbidden");
    expect(e.hint).toBeDefined();
    expect(e.hint!.some((h) => h.toLowerCase().includes("permission"))).toBe(true);
  });

  it("adds backoff hint on 5xx", () => {
    const e = explainOpenAIError(503, "Service unavailable");
    expect(e.hint).toBeDefined();
    expect(e.hint!.some((h) => h.toLowerCase().includes("retry"))).toBe(true);
  });

  it("returns raw error with no hint for unknown codes", () => {
    const e = explainOpenAIError(418, "teapot");
    expect(e.hint).toBeUndefined();
    expect(e.error).toContain("418");
  });
});

describe("explainAnthropicError", () => {
  it("adds admin-key hint on 401", () => {
    const e = explainAnthropicError(401, "Auth failed");
    expect(e.hint).toBeDefined();
    expect(e.hint!.some((h) => h.includes("Admin"))).toBe(true);
  });
});

describe("formatErrorForTerminal", () => {
  it("includes bullet-pointed hints", () => {
    const out = formatErrorForTerminal({
      error: "OpenAI 401: auth",
      status: 401,
      hint: ["do X", "try Y"],
    });
    expect(out).toContain("• do X");
    expect(out).toContain("• try Y");
  });

  it("returns just the error when no hint", () => {
    const out = formatErrorForTerminal({ error: "OpenAI 418: teapot" });
    expect(out).toBe("OpenAI 418: teapot");
  });
});

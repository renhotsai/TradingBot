import { describe, expect, it } from "vitest";
import { normalizeAlpacaBaseUrl } from "@/bot/broker";

describe("normalizeAlpacaBaseUrl", () => {
  const canonical = "https://paper-api.alpaca.markets";

  it("leaves a clean base URL untouched", () => {
    expect(normalizeAlpacaBaseUrl(canonical)).toBe(canonical);
  });

  it("strips a trailing slash", () => {
    expect(normalizeAlpacaBaseUrl(`${canonical}/`)).toBe(canonical);
  });

  it("strips a trailing /v2 (methods append their own /v2 paths)", () => {
    expect(normalizeAlpacaBaseUrl(`${canonical}/v2`)).toBe(canonical);
  });

  it("strips a trailing /v2/", () => {
    expect(normalizeAlpacaBaseUrl(`${canonical}/v2/`)).toBe(canonical);
  });

  it("works for the live URL too", () => {
    expect(normalizeAlpacaBaseUrl("https://api.alpaca.markets/v2")).toBe(
      "https://api.alpaca.markets",
    );
  });
});

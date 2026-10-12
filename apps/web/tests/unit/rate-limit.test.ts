import { describe, expect, it } from "vitest";
import { rateLimitKey } from "@/server/db/rate-limit";

const ADDRESS = "203.0.113.42";
const NOON = new Date("2026-03-04T12:00:00.000Z");

describe("rateLimitKey", () => {
  it("is a SHA-256 in hexadecimal", () => {
    expect(rateLimitKey(ADDRESS, "generation", NOON, "salt")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never contains the address", () => {
    const key = rateLimitKey(ADDRESS, "generation", NOON, "salt");
    expect(key).not.toContain(ADDRESS);
    expect(key).not.toContain("203");
    expect(rateLimitKey("2001:db8::1", "export", NOON, "")).not.toContain("db8");
  });

  it("is stable within a UTC day and changes the next day", () => {
    const early = new Date("2026-03-04T00:00:00.000Z");
    const late = new Date("2026-03-04T23:59:59.999Z");
    const next = new Date("2026-03-05T00:00:00.000Z");
    const key = rateLimitKey(ADDRESS, "generation", NOON, "salt");
    expect(rateLimitKey(ADDRESS, "generation", early, "salt")).toBe(key);
    expect(rateLimitKey(ADDRESS, "generation", late, "salt")).toBe(key);
    expect(rateLimitKey(ADDRESS, "generation", next, "salt")).not.toBe(key);
  });

  it("changes with the salt", () => {
    expect(rateLimitKey(ADDRESS, "generation", NOON, "one")).not.toBe(
      rateLimitKey(ADDRESS, "generation", NOON, "two"),
    );
  });

  it("changes with the address and with the kind", () => {
    const key = rateLimitKey(ADDRESS, "generation", NOON, "salt");
    expect(rateLimitKey("203.0.113.43", "generation", NOON, "salt")).not.toBe(key);
    expect(rateLimitKey(ADDRESS, "export", NOON, "salt")).not.toBe(key);
  });

  it("cannot be forged by moving text between the fields", () => {
    expect(rateLimitKey("a", "generation", NOON, "bsalt")).not.toBe(
      rateLimitKey("ab", "generation", NOON, "salt"),
    );
  });
});

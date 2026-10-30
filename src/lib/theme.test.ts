import { describe, expect, it } from "vitest";
import { resolveDark } from "./theme";

describe("theme mode", () => {
  it("follows the system only in system mode", () => {
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
    expect(resolveDark("dark", false)).toBe(true);
    expect(resolveDark("light", true)).toBe(false);
  });
});

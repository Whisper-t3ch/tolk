import { describe, it, expect } from "vitest";
import { AUTH_COOKIE_RE, hardenCookieOptions } from "../cookieOptions";

describe("cookieOptions", () => {
  it("куки сессии всегда HttpOnly, lax, path=/", () => {
    const o = hardenCookieOptions({ httpOnly: false, maxAge: 100, sameSite: "none" });
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe("lax");
    expect(o.path).toBe("/");
    expect(o.maxAge).toBe(100);
  });
  it("узнаёт куки сессии и куски, но не code-verifier", () => {
    expect(AUTH_COOKIE_RE.test("sb-db-auth-token")).toBe(true);
    expect(AUTH_COOKIE_RE.test("sb-db-auth-token.0")).toBe(true);
    expect(AUTH_COOKIE_RE.test("sb-db-auth-token-code-verifier")).toBe(false);
    expect(AUTH_COOKIE_RE.test("other")).toBe(false);
  });
});

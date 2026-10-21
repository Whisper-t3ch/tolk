import { describe, it, expect } from "vitest";
import { PLAN_LIMITS, isInvitePlan, limitExceededResponse } from "../assistantLimits";

describe("тарифы беты по инвайт-коду", () => {
  it("лимиты", () => {
    expect(PLAN_LIMITS.beta_paid).toBe(400);
    expect(PLAN_LIMITS.beta_free).toBe(50);
    expect(PLAN_LIMITS.unlimited).toBeGreaterThan(100000);
  });
  it("isInvitePlan", () => {
    expect(isInvitePlan("beta_free")).toBe(true);
    expect(isInvitePlan("unlimited")).toBe(true);
    expect(isInvitePlan("beta")).toBe(false);
    expect(isInvitePlan(null)).toBe(false);
  });
  it("сообщения при исчерпании", () => {
    expect(limitExceededResponse(50, { expired: true, planName: "beta_free" }).error).toMatch(/Пробный доступ закончился/);
    expect(limitExceededResponse(400, { planName: "beta_paid" }).error).toMatch(/Помощь/);
    expect(limitExceededResponse(200, { planName: "beta" }).error).toMatch(/Докупить/);
  });
});

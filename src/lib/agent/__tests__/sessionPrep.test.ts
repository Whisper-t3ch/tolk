import { describe, expect, it } from "vitest";
import { buildSessionPrep } from "../sessionPrep";

describe("buildSessionPrep", () => {
  const sessions = [
    { id: "2", scheduled_at: "2026-09-08T17:00:00Z", transcript: "Психолог: Как вы?\n\nКлиент: Иногда кажется, что всем легче без меня.\n\nПсихолог: Договоримся: пишите мне, если мысли усилятся.", soap: null },
    { id: "1", scheduled_at: "2026-09-01T17:00:00Z", transcript: "Клиент: Злюсь на мужа.", soap: { a_assessment: "Гнев на фоне усталости", p_plan: "Дневник злости" } },
    { id: "3", scheduled_at: "2026-09-15T17:00:00Z", transcript: "Психолог: Как прошла неделя?\n\nКлиент: Лучше.", soap: null },
  ];
  it("последняя целиком, прошлые — протокол или концовка, по порядку", () => {
    const r = buildSessionPrep(sessions)!;
    expect(r.last_session.session).toContain("Сессия 3 из 3");
    expect(r.last_session.text).toContain("Как прошла неделя");
    expect(r.previous_sessions[0]).toMatchObject({ protocol: "Гнев на фоне усталости\nДневник злости" });
    expect((r.previous_sessions[1] as { ending: string }).ending).toContain("Договоримся");
  });
  it("находит отметки риска в репликах клиента", () => {
    const r = buildSessionPrep(sessions)!;
    expect(r.risk_mentions).toHaveLength(1);
    expect(r.risk_mentions[0].session).toBe("Сессия 2 из 3");
  });
  it("null без данных", () => {
    expect(buildSessionPrep([{ id: "x", scheduled_at: "2026-09-01", transcript: null, soap: null }])).toBeNull();
  });
});

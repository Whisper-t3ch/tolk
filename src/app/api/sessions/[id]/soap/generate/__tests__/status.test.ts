import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase } from "@/lib/soap/__tests__/fakeSupabase";
import { NO_DATA_FIELD_TEXT } from "@/lib/soap/groundedness";

const holder: { client: unknown } = { client: null };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => holder.client }));

const opMock = vi.fn();
vi.mock("@/lib/yandexgpt", async () => {
  const actual = await vi.importActual<typeof import("@/lib/yandexgpt")>("@/lib/yandexgpt");
  return { ...actual, yandexGptGetAsyncOperation: (...a: unknown[]) => opMock(...a) };
});

import { GET } from "../status/route";

const SESSION_ID = "s-3";
const TRANSCRIPT = `Психолог: Здравствуйте, Анна. Как прошла неделя?
Клиент: Тяжело, я плохо сплю, просыпаюсь в три часа ночи и не могу уснуть, тревога сильная.
Психолог: Договоримся, что на следующей встрече разберём ссору с мамой.`;

function setup(jobStatus = "pending") {
  const fake = makeFakeSupabase({
    soap_generation_jobs: [{ id: "job-1", session_id: SESSION_ID, psychologist_id: "user-1", operation_id: "op-1", status: jobStatus, result: null, error_message: null, template_id: null }],
    sessions: [{ id: SESSION_ID, scheduled_at: "2026-10-03T10:00:00Z", client_id: "c-1", psychologist_id: "user-1" }],
    session_transcripts: [{ session_id: SESSION_ID, raw_text: TRANSCRIPT, duration_seconds: 600, created_at: "x" }],
    soap_notes: [],
  });
  holder.client = fake.client;
  return fake;
}

async function get() {
  const res = await GET(new NextRequest("http://localhost/api?job_id=job-1"), { params: Promise.resolve({ id: SESSION_ID }) });
  return res.json();
}

beforeEach(() => opMock.mockReset());

describe("GET /soap/generate/status — отказные сценарии и пост-проверка", () => {
  it("модерация отклонила уже саму генерацию → manual_review_required, job обновлён", async () => {
    opMock.mockResolvedValue({ done: true, text: null, error: "YandexGPT: ответ заблокирован фильтром контента", moderated: true });
    const { db } = setup();
    const body = await get();
    expect(body).toMatchObject({ status: "manual_review_required", code: "manual_review_required" });
    expect(db.tables.soap_generation_jobs[0].status).toBe("manual_review_required");
    expect(db.inserted.soap_notes).toBeUndefined();
  });

  it("повторный опрос уже отклонённого job возвращает то же без обращения к YandexGPT", async () => {
    setup("manual_review_required");
    const body = await get();
    expect(body.status).toBe("manual_review_required");
    expect(opMock).not.toHaveBeenCalled();
  });

  it("выдуманные ДЗ/диагноз/рекомендация заменяются на «Недостаточно данных», остальное сохраняется, aiGenerated=true", async () => {
    opMock.mockResolvedValue({
      done: true,
      error: null,
      text: JSON.stringify({
        s: "Клиентка плохо спит, просыпается ночью и не может уснуть; отмечает сильную тревогу.",
        o: "Недостаточно данных",
        a: "Возможно тревожное расстройство с признаками депрессии.",
        p: "Вести дневник благодарности и пройти консультацию психиатра. На следующей встрече разобрать ссору с мамой.",
      }),
    });
    const { db } = setup();
    const body = await get();
    expect(body.status).toBe("done");
    expect(body.soapNote.aiGenerated).toBe(true);
    expect(body.soapNote.s).toContain("плохо спит");
    expect(body.soapNote.a).toBe(NO_DATA_FIELD_TEXT);
    expect(body.soapNote.p).toBe(NO_DATA_FIELD_TEXT);
    expect(body.guardIssues.map((i: { block: string }) => i.block).sort()).toEqual(expect.arrayContaining(["a", "p"]));
    const saved = db.inserted.soap_notes[0];
    expect(saved).toMatchObject({ ai_generated: true });
    // в job сохраняются только блок и тип проблемы, не текст
    expect(JSON.stringify(db.tables.soap_generation_jobs[0].result)).not.toContain("тревожное");
  });

  it("корректный черновик проходит без замен", async () => {
    opMock.mockResolvedValue({
      done: true,
      error: null,
      text: JSON.stringify({
        s: "Клиентка плохо спит, просыпается в три часа ночи; сильная тревога.",
        o: "Недостаточно данных",
        a: "Недостаточно данных",
        p: "На следующей встрече разобрать ссору с мамой.",
      }),
    });
    setup();
    const body = await get();
    expect(body.guardIssues).toEqual([]);
    expect(body.soapNote.p).toBe("На следующей встрече разобрать ссору с мамой.");
  });

  it("ответ модели не JSON → error, протокол не сохраняется", async () => {
    opMock.mockResolvedValue({ done: true, error: null, text: "Извините, не получилось" });
    const { db } = setup();
    const body = await get();
    expect(body.status).toBe("error");
    expect(db.inserted.soap_notes).toBeUndefined();
  });
});

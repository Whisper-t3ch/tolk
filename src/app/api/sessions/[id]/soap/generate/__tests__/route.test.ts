import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase } from "@/lib/soap/__tests__/fakeSupabase";
import { YandexGptError } from "@/lib/yandexgpt";
import { PROTOCOL_SYSTEM_PROMPT_MANUAL_DEGRADE, PROTOCOL_SYSTEM_PROMPT_JITSI_GIGAAM } from "@/lib/prompts/soap";
import { PROFANITY_MARKER } from "@/lib/profanity";

const holder: { client: unknown } = { client: null };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => holder.client }));

const startMock = vi.fn();
vi.mock("@/lib/yandexgpt", async () => {
  const actual = await vi.importActual<typeof import("@/lib/yandexgpt")>("@/lib/yandexgpt");
  return { ...actual, checkYandexGptEnv: () => ({ configured: true, missing: [] }), yandexGptStartAsyncCompletion: (...a: unknown[]) => startMock(...a) };
});

import { POST } from "../route";

const SESSION_ID = "s-3";
const MODERATION = () => new YandexGptError("YandexGPT (async) вернул ошибку 400", 400, { error: { message: "Я не могу обсуждать эту тему" } });

function words(n: number, prefix: string): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}ъ`).join(" ");
}
const GOOD_TRANSCRIPT =
  `Психолог: Как вы себя чувствовали эта неделя? ${words(140, "псих")}\n\n` +
  `Клиент: Это полное [нецензурное слово], я устала от ссор. ${words(150, "клиент")}`;

function setup(opts: { transcript?: string | null; duration?: number | null; notes?: Record<string, string>; previousNote?: boolean }) {
  const tables: Record<string, any[]> = {
    sessions: [
      // фейковый order() не сортирует — порядок как по scheduled_at по возрастанию
      { id: "s-2", scheduled_at: "2026-09-26T10:00:00Z", client_id: "c-1", psychologist_id: "user-1" },
      { id: SESSION_ID, scheduled_at: "2026-10-03T10:00:00Z", client_id: "c-1", psychologist_id: "user-1", clients: { name: "Анна" } },
    ],
    session_transcripts: opts.transcript ? [{ session_id: SESSION_ID, raw_text: opts.transcript, duration_seconds: opts.duration ?? 600, created_at: "x" }] : [],
    soap_notes: [
      ...(opts.notes ? [{ session_id: SESSION_ID, s_subjective: "", o_objective: "", a_assessment: "", p_plan: "", ...opts.notes, created_at: "x" }] : []),
      ...(opts.previousNote ? [{ session_id: "s-2", a_assessment: "ПРОШЛАЯ_ГИПОТЕЗА", p_plan: "ПРОШЛЫЙ_ПЛАН", created_at: "y" }] : []),
    ],
    soap_generation_jobs: [],
  };
  const fake = makeFakeSupabase(tables);
  holder.client = fake.client;
  return fake;
}

async function post() {
  const res = await POST(new NextRequest("http://localhost/api", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: SESSION_ID }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  startMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/sessions/[id]/soap/generate — отказные сценарии", () => {
  it("реальный короткий транскрипт 03.10 (шум) → 422 insufficient_data, YandexGPT НЕ вызывается", async () => {
    const real =
      "Психолог: .\n\nКлиент: бязательно Здравствуйте.\n\nКлиент: Что-то не успеваю ничего делать особо. Так, сейчас ещё. Так, как бы мне открыть мысли? Так, или оно? А никак мне\n\nПсихолог: Здравствуйте, Анна. Как вы себя чувствовали на этой неделе?\n\nПсихолог: Что в первую очередь вас беспокоило?";
    const { db } = setup({ transcript: real, duration: 146 });
    const { status, body } = await post();
    expect(status).toBe(422);
    expect(body.code).toBe("insufficient_data");
    expect(body.error).toBe("Недостаточно данных для черновика протокола");
    expect(startMock).not.toHaveBeenCalled();
    expect(db.inserted.soap_generation_jobs).toBeUndefined();
  });

  it("нет ни записи, ни заметок → 422 insufficient_data", async () => {
    setup({ transcript: null });
    const { status, body } = await post();
    expect(status).toBe(422);
    expect(body).toMatchObject({ code: "insufficient_data", reason: "no_input" });
    expect(startMock).not.toHaveBeenCalled();
  });

  it("слишком мало заметок и плохой транскрипт → 422", async () => {
    setup({ transcript: "Клиент: привет", notes: { s_subjective: "плакала" } });
    const { status } = await post();
    expect(status).toBe(422);
  });

  it("нормальный транскрипт с матом: мат маскируется до отправки, job создан", async () => {
    startMock.mockResolvedValue("op-1");
    const raw = GOOD_TRANSCRIPT.replace("[нецензурное слово]", "хуйня полная, блядь");
    const { db } = setup({ transcript: raw, previousNote: true });
    const { status, body } = await post();
    expect(status).toBe(200);
    expect(body.status).toBe("pending");
    const messages = startMock.mock.calls[0][0] as Array<{ role: string; text: string }>;
    const userText = messages.find(m => m.role === "user")!.text;
    expect(userText).toContain(PROFANITY_MARKER);
    expect(userText).not.toMatch(/хуйн|блядь/i);
    expect(userText).toContain("ПРОШЛАЯ_ГИПОТЕЗА");
    expect(messages.find(m => m.role === "system")!.text).toBe(PROTOCOL_SYSTEM_PROMPT_JITSI_GIGAAM);
    expect(db.inserted.soap_generation_jobs[0]).toMatchObject({ status: "pending", operation_id: "op-1" });
  });

  it("модерация отклонила полный запрос → вторая «безопасная» попытка без шаблона/резюме/заметок успешна", async () => {
    startMock.mockRejectedValueOnce(MODERATION()).mockResolvedValueOnce("op-2");
    setup({ transcript: GOOD_TRANSCRIPT, notes: { s_subjective: "ЗАМЕТКА_ПСИХОЛОГА" }, previousNote: true });
    const { status, body } = await post();
    expect(status).toBe(200);
    expect(body.status).toBe("pending");
    expect(startMock).toHaveBeenCalledTimes(2);
    const first = (startMock.mock.calls[0][0] as Array<{ role: string; text: string }>).find(m => m.role === "user")!.text;
    const second = (startMock.mock.calls[1][0] as Array<{ role: string; text: string }>).find(m => m.role === "user")!.text;
    expect(first).toContain("ПРОШЛАЯ_ГИПОТЕЗА");
    expect(first).toContain("ЗАМЕТКА_ПСИХОЛОГА");
    expect(second).not.toContain("ПРОШЛАЯ_ГИПОТЕЗА");
    expect(second).not.toContain("ЗАМЕТКА_ПСИХОЛОГА");
    expect(second).toContain("полное");
  });

  it("модерация отклонила обе попытки → 422 manual_review_required, статус сохранён без текста сессии", async () => {
    startMock.mockRejectedValue(MODERATION());
    const { db } = setup({ transcript: GOOD_TRANSCRIPT });
    const { status, body } = await post();
    expect(status).toBe(422);
    expect(body.code).toBe("manual_review_required");
    expect(body.error).toMatch(/вручную/);
    expect(startMock).toHaveBeenCalledTimes(2);
    const job = db.inserted.soap_generation_jobs[0];
    expect(job).toMatchObject({ status: "manual_review_required" });
    expect(JSON.stringify(job)).not.toContain("полное");
  });

  it("не-модерационная ошибка YandexGPT → 502 без повторной попытки", async () => {
    startMock.mockRejectedValue(new YandexGptError("YandexGPT (async) вернул ошибку 503", 503));
    setup({ transcript: GOOD_TRANSCRIPT });
    const { status } = await post();
    expect(status).toBe(502);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("плохой транскрипт, но достаточно заметок → генерация по заметкам (режим без записи), транскрипт модели не передаётся", async () => {
    startMock.mockResolvedValue("op-3");
    setup({
      transcript: "Клиент: ну это самое",
      notes: { s_subjective: `Клиентка жалуется на бессонницу и ссоры с мамой. ${words(25, "заметка")}` },
    });
    const { status } = await post();
    expect(status).toBe(200);
    const messages = startMock.mock.calls[0][0] as Array<{ role: string; text: string }>;
    expect(messages.find(m => m.role === "system")!.text).toBe(PROTOCOL_SYSTEM_PROMPT_MANUAL_DEGRADE);
    expect(messages.find(m => m.role === "user")!.text).not.toContain("ну это самое");
  });
});

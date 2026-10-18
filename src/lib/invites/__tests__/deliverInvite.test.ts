import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/messengers/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/messengers/client")>("@/lib/messengers/client");
  return { ...actual, sendViaMessenger: vi.fn() };
});

import { sendViaMessenger, MessengerSendError } from "@/lib/messengers/client";
import { deliverInviteToClientChat } from "../deliverInvite";

type Tables = Record<string, unknown>;

// Минимальная цепочка: любой .select/.eq/.gte/.limit возвращает себя, .maybeSingle() отдаёт данные таблицы.
function fakeSupabase(tables: Tables, inserted: unknown[] = []) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "limit"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: tables[table] ?? null });
      chain.insert = async (row: unknown) => { inserted.push({ table, row }); return { error: null }; };
      return chain;
    },
  } as never;
}

const params = { psychologistId: "p1", clientId: "c1", sessionId: "s1", text: "Ссылка: https://x/join/t" };
const mocked = vi.mocked(sendViaMessenger);

describe("deliverInviteToClientChat", () => {
  beforeEach(() => { mocked.mockReset(); });

  it("нет привязки чата → no_channel, ничего не отправляется", async () => {
    const r = await deliverInviteToClientChat(fakeSupabase({}), params);
    expect(r).toEqual({ status: "no_channel" });
    expect(mocked).not.toHaveBeenCalled();
  });

  it("есть привязка и подключённый бот → sent и запись в messages", async () => {
    mocked.mockResolvedValue({ externalMessageId: "42" });
    const inserted: unknown[] = [];
    const supabase = fakeSupabase(
      { client_messenger_links: { external_chat_id: "123" }, messenger_integrations: { bot_token: "tok", vk_group_id: null, status: "connected" } },
      inserted
    );
    const r = await deliverInviteToClientChat(supabase, params);
    expect(r).toEqual({ status: "sent", channel: "telegram" });
    expect(mocked).toHaveBeenCalledWith("telegram", { botToken: "tok", vkGroupId: null }, "123", params.text);
    expect(inserted).toHaveLength(1);
  });

  it("повторная отправка по той же сессии подавляется (dedupe)", async () => {
    const supabase = fakeSupabase({ messages: { channel: "telegram" } });
    const r = await deliverInviteToClientChat(supabase, { ...params, dedupeMinutes: 180 });
    expect(r).toEqual({ status: "already_sent", channel: "telegram" });
    expect(mocked).not.toHaveBeenCalled();
  });

  it("ошибка мессенджера → failed с понятным текстом", async () => {
    mocked.mockRejectedValue(new MessengerSendError("chat not found", "telegram"));
    const supabase = fakeSupabase({
      client_messenger_links: { external_chat_id: "123" },
      messenger_integrations: { bot_token: "tok", vk_group_id: null, status: "connected" },
    });
    const r = await deliverInviteToClientChat(supabase, params);
    expect(r).toEqual({ status: "failed", error: "chat not found" });
  });
});

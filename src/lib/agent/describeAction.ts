// Человекочитаемое описание действий ассистента — для карточки подтверждения и итога после неё.
import type { SupabaseClient } from "@supabase/supabase-js";
import { collectClientNames, expandSessionStarts, formatSessionStart, type CreateSessionArgs } from "./scheduling";

async function clientNameById(supabase: SupabaseClient, psychologistId: string, id: unknown): Promise<string | null> {
  if (typeof id !== "string") return null;
  const { data } = await supabase.from("clients").select("name").eq("id", id).eq("psychologist_id", psychologistId).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

export class ActionPreviewError extends Error {}

export async function describeAction(
  supabase: SupabaseClient,
  psychologistId: string,
  timeZone: string,
  tool: string,
  args: Record<string, unknown>,
  knownClientName?: string
): Promise<string> {
  const clientName = knownClientName ?? (await clientNameById(supabase, psychologistId, args.client_id));
  const who = clientName ? `клиенту ${clientName}` : "клиенту";
  switch (tool) {
    case "create_client": {
      const names = collectClientNames(args as { name?: unknown; names?: unknown });
      if (names.length === 0) throw new ActionPreviewError("не понял, как зовут клиента");
      if (names.length === 1) return `Создать клиента «${names[0]}».`;
      return `Создать клиентов (${names.length}): ${names.join(", ")}.`;
    }
    case "update_client":
      return clientName ? `Изменить данные клиента ${clientName}.` : `Изменить данные клиента.`;
    case "create_session": {
      let starts: Date[];
      try {
        starts = expandSessionStarts(args as CreateSessionArgs, timeZone);
      } catch (e) {
        throw new ActionPreviewError(e instanceof Error ? e.message : "некорректные дата или время");
      }
      const duration = typeof args.duration_minutes === "number" ? args.duration_minutes : 50;
      const withWho = clientName ? ` с клиентом ${clientName}` : "";
      if (starts.length === 1) return `Создать сессию${withWho}: ${formatSessionStart(starts[0], timeZone)} (${duration} мин).`;
      return `Создать сессии${withWho} (${starts.length}, по ${duration} мин):\n` + starts.map(s => `— ${formatSessionStart(s, timeZone)}`).join("\n");
    }
    case "cancel_session": {
      if (typeof args.session_id === "string") {
        const { data } = await supabase
          .from("sessions")
          .select("scheduled_at, client:clients(name)")
          .eq("id", args.session_id)
          .eq("psychologist_id", psychologistId)
          .maybeSingle();
        if (data?.scheduled_at) {
          const c = data.client as { name?: string } | { name?: string }[] | null;
          const name = Array.isArray(c) ? c[0]?.name : c?.name;
          return `Отменить сессию${name ? ` с клиентом ${name}` : ""}: ${formatSessionStart(new Date(data.scheduled_at as string), timeZone)}.`;
        }
      }
      return `Отменить сессию.`;
    }
    case "send_message_to_client":
      return `Отправить ${who} сообщение: «${String(args.text ?? "").slice(0, 120)}».`;
    case "send_homework":
      return `Отправить ${who} домашнее задание: «${String(args.homework_text ?? "").slice(0, 160)}».`;
    case "send_session_invite":
      return `Отправить ${who} ссылку на сессию.`;
    case "send_broadcast_message":
      return `Разослать сообщение всем активным клиентам: «${String(args.text ?? "").slice(0, 120)}».`;
    default:
      return `Выполнить действие: ${tool}.`;
  }
}

/** Итог после выполнения подтверждённого действия. */
export function describeSuccess(tool: string, output: unknown, timeZone: string): string {
  const o = (output ?? {}) as Record<string, unknown>;
  switch (tool) {
    case "create_client": {
      const clients = Array.isArray(o.clients) ? (o.clients as Array<{ name: string }>) : [];
      const failed = Array.isArray(o.failed) ? (o.failed as string[]) : [];
      const base = clients.length > 1 ? `Создано клиентов: ${clients.length} — ${clients.map(c => c.name).join(", ")}.` : "Клиент создан.";
      return failed.length ? `${base} Не удалось создать: ${failed.join(", ")}.` : base;
    }
    case "update_client":
      return "Данные клиента обновлены.";
    case "create_session": {
      const sessions = Array.isArray(o.sessions) ? (o.sessions as Array<{ scheduled_at: string }>) : [];
      const skipped = Array.isArray(o.skipped_busy) ? (o.skipped_busy as string[]) : [];
      const base =
        sessions.length > 1
          ? `Создано сессий: ${sessions.length}.`
          : sessions.length === 1
            ? `Сессия создана: ${formatSessionStart(new Date(sessions[0].scheduled_at), timeZone)}.`
            : "Сессия создана.";
      return skipped.length ? `${base} Пропущено, время занято: ${skipped.join("; ")}.` : base;
    }
    case "cancel_session":
      return "Сессия отменена.";
    case "send_message_to_client":
      return "Сообщение подготовлено и сохранено. Отправка в мессенджер будет доступна после подключения каналов.";
    case "send_homework":
      return "Домашнее задание подготовлено и сохранено. Отправка в мессенджер будет доступна после подключения каналов.";
    case "send_session_invite":
      return "Приглашение подготовлено и сохранено. Отправка будет доступна после подключения каналов и видеосвязи.";
    case "send_broadcast_message":
      return "Рассылка подготовлена и сохранена для всех активных клиентов. Реальная отправка будет доступна после подключения каналов.";
    default:
      return "Готово.";
  }
}

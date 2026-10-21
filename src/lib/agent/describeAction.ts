// Человекочитаемое описание действий ассистента — для карточки подтверждения и итога после неё.
import type { SupabaseClient } from "@supabase/supabase-js";
import { collectClientNames, expandSessionStarts, formatSessionStart, type CreateSessionArgs } from "./scheduling";

async function clientNameById(supabase: SupabaseClient, psychologistId: string, id: unknown): Promise<string | null> {
  if (typeof id !== "string") return null;
  const { data } = await supabase.from("clients").select("name").eq("id", id).eq("psychologist_id", psychologistId).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

export class ActionPreviewError extends Error {}

async function loadSession(supabase: SupabaseClient, psychologistId: string, id: unknown) {
  if (typeof id !== "string") return null;
  const { data } = await supabase
    .from("sessions")
    .select("scheduled_at, status, duration_minutes, client:clients(name)")
    .eq("id", id)
    .eq("psychologist_id", psychologistId)
    .maybeSingle();
  if (!data) return null;
  const c = data.client as { name?: string } | { name?: string }[] | null;
  return {
    scheduledAt: new Date(data.scheduled_at as string),
    status: data.status as string,
    duration: (data.duration_minutes as number | null) ?? 50,
    clientName: (Array.isArray(c) ? c[0]?.name : c?.name) ?? null,
  };
}

const FIELD_LABELS: Record<string, string> = {
  name: "имя", request: "запрос", approach: "подход", status: "статус", age: "возраст", gender: "пол", needs_attention: "требует внимания",
};
const STATUS_LABELS: Record<string, string> = { active: "активный", pause: "на паузе", paused: "на паузе", completed: "завершён", archived: "в архиве" };

const PLACEHOLDER = /\[[^\]]{2,80}\]/;

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
      if (names.length === 1 && args.then_session && typeof args.then_session === "object") {
        let starts: Date[];
        try {
          starts = expandSessionStarts(args.then_session as CreateSessionArgs, timeZone);
        } catch (e) {
          throw new ActionPreviewError(e instanceof Error ? e.message : "некорректные дата или время");
        }
        const list = starts.length === 1 ? formatSessionStart(starts[0], timeZone) : `\n${starts.map(d => `— ${formatSessionStart(d, timeZone)}`).join("\n")}`;
        return `Создать клиента «${names[0]}» и сразу поставить ему сессию${starts.length > 1 ? ` (${starts.length})` : ""}: ${list} (50 мин).`;
      }
      if (names.length === 1) return `Создать клиента «${names[0]}».`;
      return `Создать клиентов (${names.length}): ${names.join(", ")}.`;
    }
    case "update_client": {
      if (!clientName) throw new ActionPreviewError("не нашёл такого клиента среди ваших — назовите его имя");
      const fields = (args.fields ?? {}) as Record<string, unknown>;
      const parts = Object.entries(fields)
        .filter(([k]) => k in FIELD_LABELS)
        .map(([k, v]) => `${FIELD_LABELS[k]} → ${k === "status" ? STATUS_LABELS[String(v)] ?? String(v) : String(v)}`);
      const base = clientName ? `Изменить данные клиента ${clientName}` : `Изменить данные клиента`;
      return parts.length ? `${base}: ${parts.join("; ")}.` : `${base}.`;
    }
    case "create_session": {
      if (!clientName) {
        throw new ActionPreviewError(
          "не понял, с каким клиентом поставить сессию — назовите клиента. Личные события (тренировки, обед) в расписание я не добавляю, только сессии с клиентами"
        );
      }
      let starts: Date[];
      try {
        starts = expandSessionStarts(args as CreateSessionArgs, timeZone);
      } catch (e) {
        throw new ActionPreviewError(e instanceof Error ? e.message : "некорректные дата или время");
      }
      const duration = typeof args.duration_minutes === "number" ? args.duration_minutes : 50;
      const withWho = clientName ? ` с клиентом ${clientName}` : "";
      // Предупреждаем о занятом времени заранее: иначе карточка выглядит выполнимой, а при подтверждении сессия пропускается.
      const { data: busyRows } = await supabase
        .from("sessions")
        .select("scheduled_at, duration_minutes")
        .eq("psychologist_id", psychologistId)
        .neq("status", "cancelled")
        .gte("scheduled_at", new Date(starts[0].getTime() - 12 * 3600_000).toISOString())
        .lte("scheduled_at", new Date(starts[starts.length - 1].getTime() + 12 * 3600_000).toISOString());
      const busy = (busyRows ?? []).map(b => {
        const st = new Date(b.scheduled_at as string).getTime();
        return { start: st, end: st + ((b.duration_minutes as number | null) ?? 50) * 60_000 };
      });
      const isBusy = (d: Date) => busy.some(b => d.getTime() < b.end && d.getTime() + duration * 60_000 > b.start);
      const mark = (d: Date) => `${formatSessionStart(d, timeZone)}${isBusy(d) ? " — занято, будет пропущено" : ""}`;
      if (starts.length === 1) return `Создать сессию${withWho}: ${mark(starts[0])} (${duration} мин).`;
      return `Создать сессии${withWho} (${starts.length}, по ${duration} мин):\n` + starts.map(s => `— ${mark(s)}`).join("\n");
    }
    case "cancel_session": {
      const ses = await loadSession(supabase, psychologistId, args.session_id);
      if (!ses) throw new ActionPreviewError("не нашёл такую сессию — назовите клиента и дату");
      if (ses.status === "cancelled") throw new ActionPreviewError("эта сессия уже отменена");
      if (ses.scheduledAt.getTime() < Date.now()) throw new ActionPreviewError("эта сессия уже прошла, отменять её нельзя");
      return `Отменить сессию${ses.clientName ? ` с клиентом ${ses.clientName}` : ""}: ${formatSessionStart(ses.scheduledAt, timeZone)}.`;
    }
    case "reschedule_session": {
      const ses = await loadSession(supabase, psychologistId, args.session_id);
      if (!ses) throw new ActionPreviewError("не нашёл такую сессию — назовите клиента и дату");
      if (ses.status === "cancelled") throw new ActionPreviewError("эта сессия отменена, переносить нечего");
      if (ses.scheduledAt.getTime() < Date.now()) throw new ActionPreviewError("эта сессия уже прошла, переносить её нельзя");
      let target: Date;
      try {
        target = expandSessionStarts({ date: args.date as string | undefined, time: args.time as string | undefined }, timeZone)[0];
      } catch (e) {
        throw new ActionPreviewError(e instanceof Error ? e.message : "некорректные дата или время");
      }
      const { data: others } = await supabase
        .from("sessions")
        .select("scheduled_at, duration_minutes")
        .eq("psychologist_id", psychologistId)
        .neq("status", "cancelled")
        .gte("scheduled_at", new Date(target.getTime() - 12 * 3600_000).toISOString())
        .lte("scheduled_at", new Date(target.getTime() + 12 * 3600_000).toISOString());
      const clash = (others ?? []).some(b => {
        const st = new Date(b.scheduled_at as string).getTime();
        if (st === ses.scheduledAt.getTime()) return false;
        return target.getTime() < st + ((b.duration_minutes as number | null) ?? 50) * 60_000 && target.getTime() + ses.duration * 60_000 > st;
      });
      return `Перенести сессию${ses.clientName ? ` с клиентом ${ses.clientName}` : ""}: ${formatSessionStart(ses.scheduledAt, timeZone)} → ${formatSessionStart(target, timeZone)}${clash ? " (это время занято, перенос не получится)" : ""}.`;
    }
    case "send_message_to_client":
      if (PLACEHOLDER.test(String(args.text ?? ""))) throw new ActionPreviewError("в тексте остался пропуск в скобках — напишите, что именно подставить (например, новое время)");
      return `Отправить ${who} сообщение: «${String(args.text ?? "").slice(0, 120)}».`;
    case "send_homework":
      if (PLACEHOLDER.test(String(args.homework_text ?? ""))) throw new ActionPreviewError("в тексте задания остался пропуск в скобках — уточните, что подставить");
      return `Отправить ${who} домашнее задание: «${String(args.homework_text ?? "").slice(0, 160)}».`;
    case "send_session_invite": {
      const ses = await loadSession(supabase, psychologistId, args.session_id);
      if (!ses) throw new ActionPreviewError("не нашёл такую сессию — назовите клиента и дату");
      return `Отправить ${ses.clientName ? `клиенту ${ses.clientName}` : who} ссылку на сессию ${formatSessionStart(ses.scheduledAt, timeZone)}.`;
    }
    case "send_broadcast_message":
      if (PLACEHOLDER.test(String(args.text ?? ""))) throw new ActionPreviewError("в тексте рассылки остался пропуск в скобках — уточните, что подставить");
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
    case "reschedule_session":
      return typeof o.label === "string" ? `Сессия перенесена: ${o.label}.` : "Сессия перенесена.";
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

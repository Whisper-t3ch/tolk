"use client";
import { useCallback, useEffect, useState } from "react";

interface Ticket {
  id: string;
  created_at: string;
  email: string | null;
  subject: string | null;
  message: string;
  page_url: string | null;
  status: "new" | "in_progress" | "resolved";
  reply?: string | null;
  replied_at?: string | null;
}

const STATUS_LABELS: Record<Ticket["status"], string> = { new: "Новое", in_progress: "В работе", resolved: "Решено" };

export default function AdminSupportPage() {
  const [filter, setFilter] = useState<"new" | "in_progress" | "resolved" | "all">("new");
  const [items, setItems] = useState<Ticket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/support?status=${filter}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 403 ? "Нет доступа" : data.error ?? "Ошибка загрузки");
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  async function setStatus(id: string, status: Ticket["status"]) {
    await fetch("/api/admin/support", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    await load();
  }

  async function sendReply(id: string) {
    const reply = (drafts[id] ?? "").trim();
    if (!reply) return;
    const res = await fetch("/api/admin/support", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, reply }),
    });
    const data = await res.json().catch(() => ({}));
    setInfo(res.ok ? `Ответ отправлен${data.telegram ? " (и в Telegram)" : " (в приложении)"}` : data.error ?? "Ошибка");
    if (res.ok) setDrafts(d => ({ ...d, [id]: "" }));
    await load();
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1C1C1E", marginBottom: 16 }}>Обращения в поддержку</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["new", "in_progress", "resolved", "all"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: "1px solid #D9D2C5",
              background: filter === f ? "#2D6A5C" : "#FFFFFF",
              color: filter === f ? "#FFFFFF" : "#1C1C1E",
            }}
          >
            {f === "all" ? "Все" : STATUS_LABELS[f]}
          </button>
        ))}
      </div>
      {info && <p style={{ color: "#166534", fontSize: 13.5 }}>{info}</p>}
      {error && <p style={{ color: "#B91C1C", fontSize: 14 }}>{error}</p>}
      {!error && loading && <p style={{ color: "#6F5A3F", fontSize: 14 }}>Загрузка…</p>}
      {!error && !loading && items.length === 0 && <p style={{ color: "#6F5A3F", fontSize: 14 }}>Обращений нет</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map(t => (
          <div key={t.id} style={{ background: "#FFFFFF", border: "1px solid #E5DFD5", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#6F5A3F", marginBottom: 8 }}>
              <span>
                {new Date(t.created_at).toLocaleString("ru")} · {t.subject ?? "—"} &lt;{t.email ?? "нет email"}&gt;
              </span>
              <span style={{ fontWeight: 700 }}>{STATUS_LABELS[t.status]} · #{t.id.slice(0, 8)}</span>
            </div>
            <p style={{ fontSize: 14, color: "#1C1C1E", whiteSpace: "pre-wrap", margin: "0 0 10px" }}>{t.message}</p>
            {t.page_url && <p style={{ fontSize: 12, color: "#6F5A3F", margin: "0 0 10px", wordBreak: "break-all" }}>Страница: {t.page_url}</p>}
            {t.reply && (
              <p style={{ fontSize: 13, color: "#1E6B54", margin: "0 0 10px", whiteSpace: "pre-wrap" }}>↩︎ Ответ: {t.reply}</p>
            )}
            <textarea
              value={drafts[t.id] ?? ""}
              onChange={e => setDrafts(d => ({ ...d, [t.id]: e.target.value }))}
              placeholder="Ответ пользователю…"
              rows={2}
              style={{ width: "100%", border: "1px solid #D9D2C5", borderRadius: 8, padding: 8, fontSize: 13, marginBottom: 8, fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => sendReply(t.id)} disabled={!(drafts[t.id] ?? "").trim()} style={{ ...btn, background: "#2D6A5C", color: "#FFFFFF", border: "1px solid #2D6A5C" }}>Отправить ответ</button>
              {t.status !== "in_progress" && (
                <button onClick={() => setStatus(t.id, "in_progress")} style={btn}>В работу</button>
              )}
              {t.status !== "resolved" && (
                <button onClick={() => setStatus(t.id, "resolved")} style={btn}>Решено</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "5px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
  border: "1px solid #D9D2C5", background: "#F5F3EF", color: "#1C1C1E",
};

"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, CheckCircle, Send } from "lucide-react";
import { Button } from "@/components/ui";

interface Questionnaire { test_key: string; title: string }
interface TestRow {
  id: string; test_type: string; score: number | null; max_score: number | null; status: string;
  created_at: string; session_id: string | null; phase: "before" | "after" | null; title: string | null;
}

const PHASE_LABEL = { before: "В начале сессии", after: "В конце сессии" } as const;

/**
 * Опросники в сессии: отправить клиенту тест «в начале» или «в конце» встречи
 * и увидеть результаты (с разницей до/после) прямо на странице сессии.
 */
export default function SessionQuestionnairesCard({ clientId, sessionId }: { clientId: string; sessionId: string }) {
  const [list, setList] = useState<Questionnaire[]>([]);
  const [tests, setTests] = useState<TestRow[]>([]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"before" | "after" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTests = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/tests`);
      if (!res.ok) return;
      const data = await res.json();
      setTests(((data.tests ?? []) as TestRow[]).filter(t => t.session_id === sessionId));
    } catch { /* не критично */ }
  }, [clientId, sessionId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/tests/questionnaires");
        if (res.ok) {
          const data = await res.json();
          setList(data.questionnaires ?? []);
        }
      } catch { /* ignore */ }
    })();
    loadTests();
  }, [loadTests]);

  const send = async (phase: "before" | "after") => {
    if (!key || busy) return;
    setBusy(phase);
    setNote(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/tests/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionnaire_key: key, session_id: sessionId, phase }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNote({ ok: false, text: data.error || "Не удалось отправить тест" }); return; }
      setNote({
        ok: true,
        url: data.test_url,
        text: data.message_status === "sent"
          ? "Тест отправлен клиенту в мессенджер."
          : "Мессенджер клиента не подключён — отправьте ссылку вручную:",
      });
      await loadTests();
    } finally {
      setBusy(null);
    }
  };

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  // Сравнение до/после по одной методике
  const pairs = useMemo(() => {
    const out: { title: string; before: TestRow; after: TestRow }[] = [];
    for (const b of tests.filter(t => t.phase === "before" && t.status === "completed")) {
      const a = tests.find(t => t.phase === "after" && t.status === "completed" && t.test_type === b.test_type);
      if (a) out.push({ title: b.title ?? b.test_type, before: b, after: a });
    }
    return out;
  }, [tests]);

  if (list.length === 0 && tests.length === 0) return null;

  return (
    <div style={{ marginTop: 16, border: "1px solid #E5DFD5", borderRadius: 12, background: "#fff", padding: "12px 14px" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E" }}>Опросники сессии</div>
      <div style={{ fontSize: 12, color: "#6F5A3F", marginTop: 2 }}>
        Отправьте клиенту тест в начале и в конце сессии, чтобы увидеть динамику.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
        <select
          value={key}
          onChange={e => setKey(e.target.value)}
          style={{ flex: "1 1 220px", minWidth: 0, padding: "8px 10px", border: "1px solid #E5DFD5", borderRadius: 8, fontSize: 13, background: "#fff" }}
        >
          <option value="">Выберите опросник…</option>
          {list.map(q => <option key={q.test_key} value={q.test_key}>{q.title}</option>)}
        </select>
        <Button size="sm" variant="secondary" onClick={() => send("before")} disabled={!key || !!busy}>
          <Send size={13} style={{ marginRight: 6 }} />{busy === "before" ? "Отправляю…" : "В начале сессии"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => send("after")} disabled={!key || !!busy}>
          <Send size={13} style={{ marginRight: 6 }} />{busy === "after" ? "Отправляю…" : "В конце сессии"}
        </Button>
      </div>

      {note && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: note.ok ? "#157347" : "#B91C1C", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>{note.text}</span>
          {note.url && (
            <button onClick={() => copy(note.url!)} style={{ background: "none", border: "none", cursor: "pointer", color: "#2D6A5C", fontWeight: 700, fontSize: 12.5, display: "flex", alignItems: "center", gap: 4 }}>
              {copied ? <CheckCircle size={13} /> : <Copy size={13} />} {copied ? "Скопировано" : "Скопировать ссылку"}
            </button>
          )}
        </div>
      )}

      {tests.length > 0 && (
        <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
          {tests.map(t => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "8px 10px", background: "#FAF9F6", borderRadius: 8, flexWrap: "wrap" }}>
              <span style={{ color: "#1C1C1E" }}>
                <b>{t.title ?? t.test_type}</b> <span style={{ color: "#6F5A3F" }}>· {t.phase ? PHASE_LABEL[t.phase] : "сессия"}</span>
              </span>
              <span style={{ color: t.status === "completed" ? "#157347" : "#92400E", fontWeight: 600 }}>
                {t.status === "completed" ? `${t.score}${t.max_score ? ` из ${t.max_score}` : ""}` : "ждём ответ клиента"}
              </span>
            </div>
          ))}
        </div>
      )}

      {pairs.map(p => {
        const diff = (p.after.score ?? 0) - (p.before.score ?? 0);
        return (
          <div key={p.before.id} style={{ marginTop: 8, fontSize: 13, color: "#1C1C1E", background: "#E8F2EF", borderRadius: 8, padding: "8px 10px" }}>
            <b>{p.title}:</b> {p.before.score} → {p.after.score} ({diff > 0 ? "+" : ""}{diff})
          </div>
        );
      })}
    </div>
  );
}

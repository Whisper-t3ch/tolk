"use client";
import { useEffect, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";
import { useVoiceDictation } from "@/lib/useVoiceDictation";

interface Note { id: string; title: string; content: string; created_at: string }

/**
 * Личные заметки психолога по клиенту (клиенту не уходят): можно напечатать или надиктовать
 * после сессии. Хранятся в дневнике психолога (reflections) с привязкой к клиенту.
 */
export default function ClientNotesTab({ clientId, timeZone }: { clientId: string; timeZone: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voice = useVoiceDictation(t => setText(prev => (prev ? `${prev} ${t}` : t)));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/reflections?client_id=${clientId}`);
        const data = await res.json();
        if (!cancelled && res.ok) setNotes(data.reflections ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("ru", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone });

  async function save() {
    const content = text.trim();
    if (!content || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reflections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Заметка · ${new Date().toLocaleDateString("ru", { day: "numeric", month: "long", timeZone })}`,
          content,
          tags: ["заметка по клиенту"],
          client_id: clientId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось сохранить заметку");
      setNotes(prev => [data.reflection, ...prev]);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить заметку");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/reflections/${id}`, { method: "DELETE" });
    if (res.ok) setNotes(prev => prev.filter(n => n.id !== id));
  }

  const recording = voice.state === "recording";
  return (
    <div style={{ maxWidth: 720 }}>
      <Card>
        <CardContent className="pt-6">
          <p style={{ fontSize: 12.5, color: "#6B6058", margin: "0 0 10px" }}>
            Ваши мысли по клиенту после сессии. Видны только вам: клиенту не отправляются.
          </p>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Напишите или надиктуйте: что заметили, гипотезы, что обсудить в следующий раз…"
            rows={5}
            style={{
              width: "100%", padding: "10px 12px", border: "1px solid #E5DFD5", borderRadius: 6,
              fontSize: 13, fontFamily: "var(--font-sans)", color: "#1C1C1E", resize: "vertical", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            {voice.supported && (
              <Button
                size="sm"
                variant="secondary"
                onClick={voice.toggle}
                disabled={voice.state === "transcribing"}
              >
                {recording ? <><Square size={12} style={{ marginRight: 6 }} /> Остановить</>
                  : voice.state === "transcribing" ? "Распознаю…"
                  : <><Mic size={14} style={{ marginRight: 6 }} /> Надиктовать</>}
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={saving || !text.trim()}>
              {saving ? "Сохраняю…" : "Сохранить заметку"}
            </Button>
            {(voice.error || error) && <span style={{ fontSize: 12, color: "#B91C1C" }}>{voice.error ?? error}</span>}
          </div>
        </CardContent>
      </Card>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {loading && <p style={{ fontSize: 13, color: "#6F5A3F" }}>Загрузка…</p>}
        {!loading && notes.length === 0 && (
          <p style={{ fontSize: 13, color: "#6F5A3F" }}>Заметок пока нет.</p>
        )}
        {notes.map(n => (
          <Card key={n.id}>
            <CardContent className="pt-4">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11.5, color: "#6F5A3F", fontWeight: 600 }}>{fmt(n.created_at)}</span>
                <button onClick={() => remove(n.id)} title="Удалить" style={{ background: "none", border: "none", cursor: "pointer", color: "#A39889" }}>
                  <Trash2 size={14} />
                </button>
              </div>
              <p style={{ fontSize: 13, color: "#1C1C1E", whiteSpace: "pre-wrap", margin: 0, lineHeight: 1.5 }}>{n.content}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

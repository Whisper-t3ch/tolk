"use client";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Copy, Check } from "lucide-react";
import { useSession } from "@/lib/SessionContext";
import { useClients } from "@/lib/ClientsContext";
import { Button, Card, CardContent } from "@/components/ui";

const FORMATS = [
  { id: "telegram", label: "Telegram-канал", icon: "📱" },
  { id: "vk", label: "ВКонтакте", icon: "🔵" },
  { id: "reels", label: "Reels-сценарий", icon: "🎬" },
  { id: "pdf", label: "PDF-гайд", icon: "📄" },
];

export default function ContentPage() {
  const { sessions } = useSession();
  const { clients } = useClients();
  const [format, setFormat] = useState("telegram");
  const [sessionId, setSessionId] = useState<string>("");
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Прошедшие сессии — только по ним могли уже появиться SOAP-протоколы
  // с реальным материалом для контента.
  const pastSessions = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return [...sessions]
      .filter(s => s.date < today)
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  }, [sessions]);

  async function generate() {
    setLoading(true);
    setGenerated(false);
    setError(null);
    try {
      const res = await fetch("/api/content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          session_id: sessionId || undefined,
          topic: sessionId ? undefined : topic || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setText(data.text);
        setGenerated(true);
      } else {
        setError(data.error ?? "Не удалось сгенерировать контент");
      }
    } catch {
      setError("Не удалось связаться с сервером");
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, color: "#1C1C1E" }}>
        Генератор контента
      </h1>
      <p style={{ fontSize: 14, color: "#6B6058", marginBottom: 24 }}>
        Инсайты из сессии в полезный контент — данные анонимизируются
      </p>

      <Card>
        <CardContent className="pt-6">
          {/* Выбор сессии */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6058", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Сессия (необязательно)
            </label>
            <select
              value={sessionId}
              onChange={e => setSessionId(e.target.value)}
              style={{
                display: "block", marginTop: 6,
                width: "100%", padding: "10px 14px",
                border: "1px solid #E5DFD5",
                borderRadius: 9, fontSize: 14,
                background: "#FFFFFF",
                fontFamily: "var(--font-sans)",
                color: "#1C1C1E",
              }}
            >
              <option value="">Без привязки к сессии — своя тема</option>
              {pastSessions.map(s => {
                const client = clients.find(c => c.id === s.clientId);
                return (
                  <option key={s.id} value={s.id}>
                    {s.clientName || client?.name || "Клиент"} — {new Date(s.date).toLocaleDateString("ru", { day: "numeric", month: "long" })}
                  </option>
                );
              })}
            </select>
          </div>

          {!sessionId && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6058", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Тема (необязательно)
              </label>
              <input
                type="text"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="Например: как справляться с тревогой перед важным событием"
                style={{
                  display: "block", marginTop: 6,
                  width: "100%", padding: "10px 14px",
                  border: "1px solid #E5DFD5",
                  borderRadius: 9, fontSize: 14,
                  background: "#FFFFFF",
                  fontFamily: "var(--font-sans)",
                  color: "#1C1C1E",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}

          {/* Формат */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6058", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Формат
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              {FORMATS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 7,
                    padding: "10px 16px",
                    background: format === f.id ? "#2D6A5C" : "#F5F3EF",
                    border: format === f.id ? "1px solid #2D6A5C" : "1px solid #E5DFD5",
                    borderRadius: 10, textAlign: "left",
                    transition: "all 0.15s ease",
                    cursor: "pointer",
                    color: format === f.id ? "#fff" : "#1C1C1E",
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  <span>{f.icon}</span> {f.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p style={{ fontSize: 12.5, color: "#EF4444", marginBottom: 12 }}>{error}</p>
          )}

          {/* Кнопка генерации */}
          <Button onClick={generate} disabled={loading} size="lg" className="w-full mb-6">
            {loading ? "Генерирую..." : <><Sparkles size={16} style={{ marginRight: 8 }} /> Сгенерировать контент</>}
          </Button>
        </CardContent>
      </Card>

      {/* Результат */}
      <AnimatePresence>
        {generated && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{ marginTop: 24 }}
          >
            <Card>
              <CardContent className="pt-6">
                <textarea
                  value={text}
                  readOnly
                  style={{
                    width: "100%", minHeight: 300,
                    padding: "12px 14px",
                    border: "1px solid #E5DFD5",
                    borderRadius: 8,
                    fontSize: 14,
                    fontFamily: "var(--font-sans)",
                    color: "#1C1C1E",
                    resize: "none",
                  }}
                />
                <Button onClick={copy} variant="primary" className="mt-4">
                  {copied ? <><Check size={14} style={{ marginRight: 6 }} /> Скопировано</> : <><Copy size={14} style={{ marginRight: 6 }} /> Копировать</>}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

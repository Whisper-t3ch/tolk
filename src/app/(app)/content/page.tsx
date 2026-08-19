"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Copy, Check } from "lucide-react";
import { mockGeneratedPost } from "@/lib/mock-data";
import { Button, Card, CardContent } from "@/components/ui";

const FORMATS = [
  { id: "telegram", label: "Telegram-канал", icon: "📱" },
  { id: "vk", label: "ВКонтакте", icon: "🔵" },
  { id: "reels", label: "Reels-сценарий", icon: "🎬" },
  { id: "pdf", label: "PDF-гайд", icon: "📄" },
];

export default function ContentPage() {
  const [format, setFormat] = useState("telegram");
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState("");

  function generate() {
    setLoading(true);
    setGenerated(false);
    setTimeout(() => {
      setLoading(false);
      setGenerated(true);
      setText((mockGeneratedPost as any)[format] || mockGeneratedPost.telegram);
    }, 2200);
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
              Сессия
            </label>
            <select style={{
              display: "block", marginTop: 6,
              width: "100%", padding: "10px 14px",
              border: "1px solid #E5DFD5",
              borderRadius: 9, fontSize: 14,
              background: "#FFFFFF",
              fontFamily: "var(--font-sans)",
              color: "#1C1C1E",
            }}>
              <option>Анна Иванова — 12 августа, сессия #8</option>
              <option>Дмитрий Орлов — 10 августа, сессия #4</option>
              <option>Светлана Морозова — 8 августа, сессия #12</option>
            </select>
          </div>

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

"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Download, Copy, FileOutput, CheckCircle, Sparkles } from "lucide-react";
import { mockSOAP } from "@/lib/mock-data";
import { Button, Card, CardContent } from "@/components/ui";

const SOAP_BLOCKS = [
  { key: "s" as const, label: "S — Субъективно", color: "#2D6A5C", emoji: "💬", hint: "Слова и описания клиента" },
  { key: "o" as const, label: "O — Объективно", color: "#1BAF7A", emoji: "👁", hint: "Ваши наблюдения, тесты, поведение" },
  { key: "a" as const, label: "A — Оценка", color: "#F59E0B", emoji: "🧠", hint: "Клинический анализ, гипотезы" },
  { key: "p" as const, label: "P — План", color: "#8B5CF6", emoji: "📋", hint: "ДЗ, задачи следующей сессии" },
];

export default function SOAPPage() {
  const [content, setContent] = useState({ ...mockSOAP });
  const [saved, setSaved] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handlePdf() {
    setPdfLoading(true);
    setTimeout(() => {
      setPdfLoading(false);
      setNotification("PDF готов и сохранён в карточку клиента");
      setTimeout(() => setNotification(null), 2500);
    }, 1500);
  }

  function handleCopy() {
    const fullText = SOAP_BLOCKS.map(b => `${b.label}\n${content[b.key]}`).join("\n\n");
    navigator.clipboard?.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 24px" }}>
      {/* Шапка */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ marginTop: 20, marginBottom: 20 }}
      >
        <Card>
          <CardContent className="pt-6">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
                    SOAP-протокол
                  </h1>
                </div>
                <p style={{ fontSize: 13, color: "#6B6058", margin: 0, marginTop: 4 }}>
                  {content.clientName} · {content.date} · Сессия #{content.sessionNumber} · {content.duration}
                </p>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <Button onClick={handlePdf} variant="outline" size="sm" disabled={pdfLoading}>
                  <Download size={14} style={{ marginRight: 4 }} />
                  {pdfLoading ? "Готовлю..." : "PDF"}
                </Button>
                <Button onClick={handleSave} variant="primary" size="sm">
                  {saved ? <><CheckCircle size={14} style={{ marginRight: 4 }} /> Сохранено</> : "Сохранить"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* SOAP блоки */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginBottom: 24 }}>
        {SOAP_BLOCKS.map((block, idx) => (
          <motion.div
            key={block.key}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.08 }}
          >
            <Card>
              <CardContent className="pt-6">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 20 }}>{block.emoji}</span>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", margin: 0 }}>
                      {block.label}
                    </h3>
                    <p style={{ fontSize: 11, color: "#8C7355", margin: 0, marginTop: 2 }}>
                      {block.hint}
                    </p>
                  </div>
                </div>

                <textarea
                  value={content[block.key]}
                  onChange={e => setContent(prev => ({ ...prev, [block.key]: e.target.value }))}
                  style={{
                    width: "100%",
                    minHeight: 150,
                    padding: "12px 14px",
                    border: `2px solid ${block.color}30`,
                    borderLeft: `4px solid ${block.color}`,
                    borderRadius: 8,
                    fontSize: 13,
                    fontFamily: "var(--font-sans)",
                    color: "#1C1C1E",
                    resize: "none",
                  }}
                />
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Генерация контента */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.32 }}
        style={{ marginBottom: 24 }}
      >
        <Card>
          <CardContent className="pt-6">
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 12 }}>
              Действия
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
              <Link href={`/content?session=${content.sessionNumber}`} style={{ textDecoration: "none" }}>
                <Button variant="primary">
                  <FileOutput size={14} style={{ marginRight: 6 }} /> Сгенерировать контент
                </Button>
              </Link>
              <Button onClick={handleCopy} variant="secondary">
                {copied ? <><CheckCircle size={14} style={{ marginRight: 6 }} /> Скопировано</> : <><Copy size={14} style={{ marginRight: 6 }} /> Копировать</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {notification && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
            background: "#1BAF7A", color: "#fff", padding: "12px 20px",
            borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 60,
            boxShadow: "0 4px 12px rgba(27, 175, 122, 0.3)",
          }}
        >
          {notification}
        </motion.div>
      )}
    </div>
  );
}

"use client";
import { use, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Download, Copy, FileOutput, CheckCircle, Sparkles, Send, X } from "lucide-react";
import { mockSOAP } from "@/lib/mock-data";
import { Button, Card, CardContent } from "@/components/ui";

const SOAP_BLOCKS = [
  { key: "s" as const, label: "S — Субъективно", color: "#2D6A5C", emoji: "💬", hint: "Слова и описания клиента" },
  { key: "o" as const, label: "O — Объективно", color: "#1BAF7A", emoji: "👁", hint: "Ваши наблюдения, тесты, поведение" },
  { key: "a" as const, label: "A — Оценка", color: "#F59E0B", emoji: "🧠", hint: "Клинический анализ, гипотезы" },
  { key: "p" as const, label: "P — План", color: "#8B5CF6", emoji: "📋", hint: "ДЗ, задачи следующей сессии" },
];

export default function SOAPPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params);
  const [content, setContent] = useState({ ...mockSOAP });
  const [saved, setSaved] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [downloadingTranscript, setDownloadingTranscript] = useState(false);
  const [showSendSummary, setShowSendSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [summaryChannel, setSummaryChannel] = useState<"telegram" | "vk" | "max">("telegram");
  const [sendingSummary, setSendingSummary] = useState(false);
  const [sendSummaryError, setSendSummaryError] = useState<string | null>(null);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleDownloadTranscript() {
    setDownloadingTranscript(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/export/transcript`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNotification(data.error ?? "Не удалось скачать транскрипт");
        setTimeout(() => setNotification(null), 3000);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "transcript.txt";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setNotification("Не удалось скачать транскрипт — проверьте соединение");
      setTimeout(() => setNotification(null), 3000);
    } finally {
      setDownloadingTranscript(false);
    }
  }

  // Короткий дружелюбный текст для клиента из S+P — не клинический язык,
  // предзаполняется при открытии модалки, психолог может отредактировать.
  function buildClientSummaryDraft(): string {
    return `Привет! Коротко о сегодняшней встрече:\n\n${content.s}\n\nЧто дальше:\n${content.p}`;
  }

  function openSendSummary() {
    setSummaryDraft(buildClientSummaryDraft());
    setSendSummaryError(null);
    setShowSendSummary(true);
  }

  async function handleSendSummary() {
    setSendingSummary(true);
    setSendSummaryError(null);
    try {
      // ВНИМАНИЕ: этот SOAP-протокол сейчас на моках (mockSOAP), у него нет
      // реального id в таблице soap_notes — реальную отправку можно
      // проверить только после того, как SOAP будет сохраняться в БД
      // (следующий шаг интеграции). Явно сообщаем об этом вместо тихой
      // отправки в никуда.
      setSendSummaryError(
        "Этот протокол ещё не сохранён в базе (страница работает на демо-данных) — отправка резюме заработает после подключения SOAP к реальным данным."
      );
    } finally {
      setSendingSummary(false);
    }
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
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href={`/content?session=${content.sessionNumber}`} style={{ textDecoration: "none" }}>
                <Button variant="primary">
                  <FileOutput size={14} style={{ marginRight: 6 }} /> Сгенерировать контент
                </Button>
              </Link>
              <Button onClick={handleCopy} variant="secondary">
                {copied ? <><CheckCircle size={14} style={{ marginRight: 6 }} /> Скопировано</> : <><Copy size={14} style={{ marginRight: 6 }} /> Копировать</>}
              </Button>
              <Button onClick={handleDownloadTranscript} variant="secondary" disabled={downloadingTranscript}>
                <Download size={14} style={{ marginRight: 6 }} />
                {downloadingTranscript ? "Скачиваю..." : "Скачать транскрипт"}
              </Button>
              <Button onClick={openSendSummary} variant="secondary">
                <Send size={14} style={{ marginRight: 6 }} /> Отправить резюме клиенту
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

      {/* Модалка отправки резюме клиенту */}
      {showSendSummary && (
        <>
          <div
            onClick={() => !sendingSummary && setShowSendSummary(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 70 }}
          />
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 75,
          }}>
            <div style={{
              background: "#FFFFFF", borderRadius: 16, width: "90%", maxWidth: 480,
              maxHeight: "85vh", overflowY: "auto", boxShadow: "0 25px 80px rgba(0,0,0,0.2)",
            }}>
              <div style={{
                padding: "18px 22px", borderBottom: "1px solid #E5DFD5",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
                  Отправить резюме клиенту
                </h2>
                <button
                  onClick={() => !sendingSummary && setShowSendSummary(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#8C7355" }}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                    Текст резюме (можно отредактировать)
                  </label>
                  <textarea
                    value={summaryDraft}
                    onChange={e => setSummaryDraft(e.target.value)}
                    style={{
                      width: "100%", minHeight: 160, padding: "10px 12px",
                      border: "1px solid #E5DFD5", borderRadius: 8,
                      fontSize: 13, fontFamily: "var(--font-sans)", color: "#1C1C1E", resize: "vertical",
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#8C7355", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                    Канал отправки
                  </label>
                  <select
                    value={summaryChannel}
                    onChange={e => setSummaryChannel(e.target.value as "telegram" | "vk" | "max")}
                    style={{
                      width: "100%", padding: "9px 12px", border: "1px solid #E5DFD5",
                      borderRadius: 8, fontSize: 13, color: "#1C1C1E", fontFamily: "var(--font-sans)", background: "#FFFFFF",
                    }}
                  >
                    <option value="telegram">Telegram</option>
                    <option value="vk">VK</option>
                    <option value="max">MAX</option>
                  </select>
                </div>

                {sendSummaryError && (
                  <p style={{ fontSize: 12.5, color: "#F59E0B", background: "#FEF3E2", borderRadius: 8, padding: "10px 12px", margin: 0 }}>
                    {sendSummaryError}
                  </p>
                )}

                <Button onClick={handleSendSummary} variant="primary" disabled={sendingSummary}>
                  {sendingSummary ? "Отправляю..." : "Отправить"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

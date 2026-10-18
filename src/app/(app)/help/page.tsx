"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Send, LifeBuoy } from "lucide-react";
import { Button, Card, CardContent, Textarea } from "@/components/ui";

// Найдено при прогоне: три из пяти ответов описывали функциональность,
// которой в продукте нет — автогенерацию протокола сразу после звонка,
// автоматическую отправку ссылки на видеозвонок клиенту, и
// редактирование клиента из несуществующей вкладки «Сводка». Тексты
// приведены в соответствие с реальным поведением (кнопка "Сгенерировать
// протокол" в разделе "Действия" сессии; ссылка на звонок психолог
// отправляет клиенту сам; редактирование — кнопка "Редактировать" в
// шапке карточки клиента).
const FAQ = [
  {
    q: "Как ассистент формирует протокол сессии?",
    a: "После завершения сессии откройте её карточку и нажмите «Сгенерировать протокол» в блоке «Действия» — ассистент соберёт протокол по заметкам и записи разговора (если она есть). Формат протокола можно изменить в разделе «База знаний» → «Шаблоны протоколов».",
  },
  {
    q: "Куда пропадают запросы к ассистенту?",
    a: "Лимит запросов обновляется ежемесячно согласно тарифу. Текущий расход виден в сайдбаре и в разделе «Настройки». При нехватке лимита можно докупить пакет запросов.",
  },
  {
    q: "Клиент не получил ссылку на видеозвонок",
    a: "Ссылка на звонок создаётся при старте сессии («Начать сессию сейчас» в карточке клиента) — отправьте её клиенту вручную, например через чат в карточке клиента или Telegram. Автоматическая рассылка ссылки не выполняется.",
  },
  {
    q: "Как изменить или удалить карточку клиента?",
    a: "Откройте карточку клиента и нажмите «Редактировать» в шапке — там же доступна архивация (удаление) клиента.",
  },
  {
    q: "Данные клиентов в безопасности?",
    a: "Да — сервера расположены в РФ, данные передаются в зашифрованном виде, платформа соответствует требованиям 152-ФЗ. Подробнее — в разделе «Настройки» → «Конфиденциальность».",
  },
];

export default function HelpPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Обращение сохраняется на сервере (support_tickets) и сразу уходит
  // владельцу платформы; ответ приходит на email аккаунта.
  const send = async () => {
    const text = message.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, pageUrl: window.location.href }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось отправить обращение");
      setSent(true);
      setMessage("");
      setTimeout(() => setSent(false), 8000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить обращение");
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.5px" }}>
          Помощь
        </h1>
        <p style={{ fontSize: 14, color: "#6B6058", marginTop: 6 }}>
          Ответы на частые вопросы и связь с поддержкой
        </p>
      </div>

      {/* FAQ */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E", marginBottom: 12 }}>
          Частые вопросы
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {FAQ.map((item, idx) => (
            <Card key={idx}>
              <CardContent className="pt-0 pb-0" style={{ padding: 0 }}>
                <button
                  onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "16px 18px", background: "none", border: "none", cursor: "pointer",
                    textAlign: "left", fontFamily: "var(--font-sans)",
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>{item.q}</span>
                  <motion.div animate={{ rotate: openIdx === idx ? 180 : 0 }}>
                    <ChevronDown size={16} style={{ color: "#6F5A3F" }} />
                  </motion.div>
                </button>
                <AnimatePresence>
                  {openIdx === idx && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      style={{ overflow: "hidden" }}
                    >
                      <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.6, padding: "0 18px 16px" }}>
                        {item.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Форма обращения */}
      <Card>
        <CardContent className="pt-6">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <LifeBuoy size={16} style={{ color: "#2D6A5C" }} />
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
              Написать в поддержку
            </h3>
          </div>
          <p style={{ fontSize: 12.5, color: "#4B443C", marginBottom: 12 }}>
            Опишите вопрос или проблему — обращение сразу попадёт к команде ТОЛК. Ответим на email вашего аккаунта.
          </p>
          <Textarea
            value={message}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
            placeholder="Опишите вопрос или проблему..."
            rows={4}
          />
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button size="md" onClick={send} disabled={!message.trim() || sending}>
              {sending ? "Отправляю…" : <>Отправить <Send size={14} style={{ marginLeft: 8 }} /></>}
            </Button>
          </div>
          <AnimatePresence>
            {sent && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                style={{ marginTop: 10, fontSize: 12.5, color: "#166534", fontWeight: 600 }}
              >
                ✓ Обращение отправлено. Ответим на email аккаунта.
              </motion.div>
            )}
          </AnimatePresence>
          {error && <p style={{ marginTop: 10, fontSize: 12.5, color: "#B91C1C" }}>{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

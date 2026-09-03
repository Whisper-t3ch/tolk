"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, MessageCircle, Mail, Send, LifeBuoy } from "lucide-react";
import { Button, Card, CardContent, Textarea } from "@/components/ui";
import { useProfile } from "@/lib/ProfileContext";

const FAQ = [
  {
    q: "Как ассистент формирует протокол сессии?",
    a: "После завершения звонка ассистент анализирует заметки и (в будущих версиях) аудио сессии, и автоматически собирает протокол по выбранному шаблону — по умолчанию SOAP. Формат можно изменить в разделе «Шаблоны протоколов».",
  },
  {
    q: "Куда пропадают запросы к ассистенту?",
    a: "Лимит запросов обновляется ежемесячно согласно тарифу. Текущий расход виден в сайдбаре и в разделе «Настройки». При нехватке лимита можно докупить пакет запросов.",
  },
  {
    q: "Клиент не получил ссылку на видеозвонок",
    a: "Ссылка отправляется автоматически через подключённый Telegram-бот в момент создания сессии. Проверьте статус подключения бота в «Настройках» → «Интеграции».",
  },
  {
    q: "Как изменить или удалить карточку клиента?",
    a: "Откройте карточку клиента → вкладка «Сводка». Редактирование профиля и архивация клиента доступны из этого раздела.",
  },
  {
    q: "Данные клиентов в безопасности?",
    a: "Да — сервера расположены в РФ, данные передаются в зашифрованном виде, платформа соответствует требованиям 152-ФЗ. Подробнее — в разделе «Настройки» → «Конфиденциальность».",
  },
];

export default function HelpPage() {
  const { profile } = useProfile();
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  const sendMessage = () => {
    if (!message.trim()) return;
    setSent(true);
    setMessage("");
    setTimeout(() => setSent(false), 3000);
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
                    <ChevronDown size={16} style={{ color: "#8C7355" }} />
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

      {/* Контакты поддержки */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 32 }}>
        <Card>
          <CardContent className="pt-6" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, background: "#E8F2EF", borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <MessageCircle size={18} style={{ color: "#2D6A5C" }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E" }}>Telegram-поддержка</div>
              <div style={{ fontSize: 12, color: "#2D6A5C" }}>@tolk_support</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, background: "#E6F7F2", borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Mail size={18} style={{ color: "#1BAF7A" }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E" }}>Почта</div>
              <div style={{ fontSize: 12, color: "#1BAF7A" }}>support@tolk.pro</div>
            </div>
          </CardContent>
        </Card>
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
          <p style={{ fontSize: 12, color: "#8C7355", marginBottom: 12 }}>
            Ответим на {profile?.telegram.username || profile?.email || "ваш контакт"} в течение рабочего дня
          </p>
          <Textarea
            value={message}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
            placeholder="Опишите вопрос или проблему..."
            rows={4}
          />
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <Button size="md" onClick={sendMessage} disabled={!message.trim()}>
              Отправить <Send size={14} style={{ marginLeft: 8 }} />
            </Button>
          </div>
          <AnimatePresence>
            {sent && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                style={{ marginTop: 10, fontSize: 12, color: "#1BAF7A", fontWeight: 600 }}
              >
                ✓ Сообщение отправлено. Мы свяжемся с вами в ближайшее время.
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  );
}

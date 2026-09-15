"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, MessageCircle, Mail, Send, LifeBuoy } from "lucide-react";
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

const SUPPORT_TELEGRAM = "tolk_support";
const SUPPORT_EMAIL = "support@tolk.pro";

export default function HelpPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  // Найдено прогоном-2: раньше эта форма ничего не отправляла — кнопка
  // просто показывала «✓ Сообщение отправлено. Мы свяжемся с вами в
  // ближайшее время» и очищала поле. Психолог с реальной проблемой ждал
  // ответа, которого никто не получал. Серверной доставки обращений в
  // продукте нет, поэтому вместо имитации формы — два настоящих канала:
  // текст уходит в буфер обмена и открывается чат поддержки, либо
  // подставляется в письмо. Обещаем только то, что действительно
  // происходит.
  const openTelegram = async () => {
    const text = message.trim();
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 4000);
      } catch {
        // Буфер может быть недоступен (нет разрешения, небезопасный
        // контекст) — это не повод не открыть чат: психолог напишет сам.
      }
    }
    window.open(`https://t.me/${SUPPORT_TELEGRAM}`, "_blank", "noopener,noreferrer");
  };

  const openEmail = () => {
    const subject = encodeURIComponent("Вопрос в поддержку ТОЛК");
    const body = encodeURIComponent(message.trim());
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
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
            Опишите вопрос здесь и выберите, куда его отправить — в Telegram или почтой. Отвечаем в течение рабочего дня.
          </p>
          <Textarea
            value={message}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
            placeholder="Опишите вопрос или проблему..."
            rows={4}
          />
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button size="md" variant="secondary" onClick={openEmail} disabled={!message.trim()}>
              <Mail size={14} style={{ marginRight: 8 }} /> Отправить почтой
            </Button>
            <Button size="md" onClick={openTelegram}>
              Написать в Telegram <Send size={14} style={{ marginLeft: 8 }} />
            </Button>
          </div>
          <AnimatePresence>
            {copied && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                style={{ marginTop: 10, fontSize: 12, color: "#1BAF7A", fontWeight: 600 }}
              >
                ✓ Текст скопирован — вставьте его в чат с @{SUPPORT_TELEGRAM}
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  );
}

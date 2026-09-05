"use client";
import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Send, Mic, Check, X as XIcon, ThumbsUp, ThumbsDown, Copy } from "lucide-react";

// Web Speech API не имеет официальных типов в TS lib.dom — минимальный
// набросок нужных полей (тот же паттерн, что в AIAssistant.tsx).
interface SpeechRecognitionResultLike {
  transcript: string;
}
interface SpeechRecognitionEventLike extends Event {
  results: { [index: number]: { [index: number]: SpeechRecognitionResultLike; length: number }; length: number };
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  // feedbackId — message_id, вернувшийся с сервера вместе с этим
  // ответом ассистента (см. POST /api/assistant, поле message_id).
  // Отличается от id тем, что id — чисто клиентский React key (нужен
  // и для welcome-сообщения, и для системных реплик подтверждения,
  // у которых feedbackId нет и оценивать их нельзя), а feedbackId —
  // это то, что реально отправляется в /api/assistant/feedback.
  // Только у role==="assistant" может быть непустым.
  feedbackId?: string;
  // Явная оценка психолога (для подсветки нажатой кнопки) — null,
  // пока психолог явно не оценил.
  rating?: "positive" | "negative" | null;
}

interface PendingAction {
  tool: string;
  arguments: Record<string, unknown>;
  description: string;
}

// Простая эвристика "похоже на переформулировку": сравниваем множества
// значимых слов (без стоп-слов и коротких слов) двух реплик — если
// пересечение достаточно большое, считаем, что психолог задал по сути
// тот же вопрос ещё раз. Не претендует на лингвистическую точность —
// это сигнал для аналитики, а не для блокирующей логики.
const STOP_WORDS = new Set([
  "как", "что", "это", "для", "или", "его", "она", "они", "мне", "мой",
  "моя", "моё", "нет", "да", "по", "на", "не", "то", "же", "бы", "но",
  "и", "а", "в", "с", "у", "к", "о", "от", "из", "за", "при", "про",
  "если", "чтобы", "есть", "был", "была", "было", "были", "можно",
]);

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\wа-яё\s]/gi, " ")
      .split(/\s+/)
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w))
  );
}

function looksLikeReformulation(prevQuestion: string, nextQuestion: string): boolean {
  const a = extractKeywords(prevQuestion);
  const b = extractKeywords(nextQuestion);
  if (a.size === 0 || b.size === 0) return false;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap += 1;
  const smaller = Math.min(a.size, b.size);
  return overlap / smaller >= 0.5;
}

export interface AssistantChatProps {
  /** Если чат открыт из карточки конкретного клиента — подмешивается в контекст запроса. */
  clientId?: string;
  /** Плейсхолдер поля ввода. */
  placeholder?: string;
  /** Компактные размеры текста/отступов — используется во встроенном виджете AIAssistant. */
  compact?: boolean;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "Привет! Я твой помощник. Помогу с клиентами, расписанием и подготовкой к сессии — спроси что-нибудь или попроси что-то сделать.",
};

export default function AssistantChat({ clientId, placeholder = "Спроси меня...", compact = true }: AssistantChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [agentSessionId, setAgentSessionId] = useState<string | undefined>(undefined);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Для неявного сигнала was_reformulated: запоминаем последний ответ
  // ассистента (его feedbackId, текст вопроса психолога, который к нему
  // привёл, и время получения). Если следующее сообщение психолога
  // придёт быстро и будет похоже по ключевым словам на тот же вопрос —
  // считаем это переформулировкой неудачного ответа.
  const lastExchangeRef = useRef<{ feedbackId: string; question: string; answeredAt: number } | null>(null);

  // При открытии — подтягиваем последнюю сохранённую переписку с ассистентом
  // (если она есть), чтобы на созвоне/при возврате в чат была видна история,
  // а не только приветствие.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/assistant/history${clientId ? `?client_id=${clientId}` : ""}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data?.agentSessionId) setAgentSessionId(data.agentSessionId);
        if (Array.isArray(data?.messages) && data.messages.length > 0) {
          setMessages([
            WELCOME_MESSAGE,
            ...data.messages.map((m: { id?: string; role: "user" | "assistant"; text: string }, i: number) => ({
              id: `h-${i}`,
              role: m.role,
              text: m.text,
              // Старые записи (до внедрения фидбека) не имеют id внутри
              // jsonb — для них просто не показываем кнопки оценки.
              feedbackId: m.role === "assistant" ? m.id : undefined,
              rating: null,
            })),
          ]);
        }
      } catch {
        // Тихо игнорируем — чат просто останется с приветствием.
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const fontSize = compact ? 12 : 13;

  const voiceSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingAction]);

  const toggleVoiceInput = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setVoiceError("Голосовой ввод не поддерживается этим браузером");
      setTimeout(() => setVoiceError(null), 3000);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "ru-RU";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      const last = event.results[event.results.length - 1];
      const text = last?.[0]?.transcript ?? "";
      if (text) {
        setInput(prev => (prev ? `${prev} ${text}` : text));
      }
    };
    recognition.onerror = () => {
      setVoiceError("Не удалось распознать речь — попробуйте ещё раз");
      setTimeout(() => setVoiceError(null), 3000);
      setIsRecording(false);
    };
    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    setIsRecording(true);
    recognition.start();
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    // Неявный сигнал was_reformulated: если предыдущий ответ ассистента
    // пришёл меньше 15 секунд назад и это сообщение похоже по ключевым
    // словам на вопрос, который к нему привёл — психолог, скорее всего,
    // не получил то, что хотел, и переспрашивает. Шлём сигнал не дожидаясь
    // ответа на новое сообщение — он относится к ПРЕДЫДУЩЕМУ ответу.
    const prevExchange = lastExchangeRef.current;
    if (prevExchange && Date.now() - prevExchange.answeredAt < 15000 && looksLikeReformulation(prevExchange.question, text)) {
      fetch("/api/assistant/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: prevExchange.feedbackId, was_reformulated: true }),
      }).catch(() => {});
    }

    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: "user", text }]);
    setInput("");
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, client_id: clientId, agent_session_id: agentSessionId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error ?? "Не удалось получить ответ ассистента");
        setIsLoading(false);
        return;
      }

      if (data.type === "confirmation_required") {
        setPendingAction({ tool: data.action.tool, arguments: data.action.arguments, description: data.description });
        setMessages(prev => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: data.description ?? "Нужно подтверждение действия." },
        ]);
        // Карточка подтверждения — не обычный ответ ассистента, оценивать
        // нечего, поэтому lastExchangeRef не обновляем.
      } else {
        const feedbackId: string | undefined = data.message_id;
        setMessages(prev => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: data.message, feedbackId, rating: null },
        ]);
        if (feedbackId) {
          lastExchangeRef.current = { feedbackId, question: text, answeredAt: Date.now() };
        }
      }
      if (data.agent_session_id) setAgentSessionId(data.agent_session_id);
    } catch {
      setError("Не удалось связаться с сервером");
    } finally {
      setIsLoading(false);
    }
  };

  const rateMessage = (messageId: string, feedbackId: string, rating: "positive" | "negative") => {
    setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, rating } : m)));
    fetch("/api/assistant/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: feedbackId, rating }),
    }).catch(() => {});
  };

  const copyMessage = (messageId: string, feedbackId: string | undefined, text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(messageId);
    setTimeout(() => setCopiedId(prev => (prev === messageId ? null : prev)), 1500);
    if (feedbackId) {
      fetch("/api/assistant/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: feedbackId, was_used: true }),
      }).catch(() => {});
    }
  };

  const respondToConfirmation = async (confirmed: boolean) => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    setIsLoading(true);
    try {
      const res = await fetch("/api/assistant/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: { tool: action.tool, arguments: action.arguments }, confirmed }),
      });
      const data = await res.json();
      setMessages(prev => [
        ...prev,
        { id: `c-${Date.now()}`, role: "assistant", text: data.message ?? data.error ?? "Готово." },
      ]);
    } catch {
      setError("Не удалось связаться с сервером");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: compact ? "12px" : "16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {messages.map(msg => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "assistant" ? "flex-start" : "flex-end" }}
          >
            <div
              style={{
                maxWidth: "85%",
                padding: "8px 12px",
                borderRadius: 8,
                background: msg.role === "assistant" ? "#F5F3EF" : "#2D6A5C",
                color: msg.role === "assistant" ? "#1C1C1E" : "#fff",
                fontSize,
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
              }}
            >
              {msg.text}
            </div>
            {msg.role === "assistant" && msg.feedbackId && (
              <div style={{ display: "flex", gap: 2, marginTop: 3, opacity: 0.55 }}>
                <button
                  onClick={() => copyMessage(msg.id, msg.feedbackId, msg.text)}
                  title="Скопировать"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: 4, borderRadius: 4, display: "flex", alignItems: "center",
                    color: copiedId === msg.id ? "#2D6A5C" : "#6B6058",
                  }}
                >
                  <Copy size={12} />
                </button>
                <button
                  onClick={() => rateMessage(msg.id, msg.feedbackId!, "positive")}
                  title="Полезный ответ"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: 4, borderRadius: 4, display: "flex", alignItems: "center",
                    color: msg.rating === "positive" ? "#2D6A5C" : "#6B6058",
                  }}
                >
                  <ThumbsUp size={12} fill={msg.rating === "positive" ? "#2D6A5C" : "none"} />
                </button>
                <button
                  onClick={() => rateMessage(msg.id, msg.feedbackId!, "negative")}
                  title="Неполезный ответ"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: 4, borderRadius: 4, display: "flex", alignItems: "center",
                    color: msg.rating === "negative" ? "#EF4444" : "#6B6058",
                  }}
                >
                  <ThumbsDown size={12} fill={msg.rating === "negative" ? "#EF4444" : "none"} />
                </button>
              </div>
            )}
          </motion.div>
        ))}

        {pendingAction && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              alignSelf: "flex-start",
              maxWidth: "90%",
              background: "#FFFFFF",
              border: "1px solid #E5DFD5",
              borderRadius: 10,
              padding: 12,
            }}
          >
            <div style={{ fontSize, color: "#1C1C1E", marginBottom: 10, fontWeight: 600 }}>
              {pendingAction.description}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => respondToConfirmation(true)}
                disabled={isLoading}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: "#2D6A5C", color: "#fff", border: "none",
                  borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600,
                  cursor: isLoading ? "not-allowed" : "pointer",
                }}
              >
                <Check size={13} /> Подтвердить
              </button>
              <button
                onClick={() => respondToConfirmation(false)}
                disabled={isLoading}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: "#F5F3EF", color: "#6B6058", border: "1px solid #E5DFD5",
                  borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600,
                  cursor: isLoading ? "not-allowed" : "pointer",
                }}
              >
                <XIcon size={13} /> Отменить
              </button>
            </div>
          </motion.div>
        )}

        {isLoading && (
          <div style={{ display: "flex", gap: 4 }}>
            <div style={{ width: 6, height: 6, background: "#8C7355", borderRadius: "50%", animation: "assistantBounce 1.4s infinite" }} />
            <div style={{ width: 6, height: 6, background: "#8C7355", borderRadius: "50%", animation: "assistantBounce 1.4s infinite", animationDelay: "0.2s" }} />
            <div style={{ width: 6, height: 6, background: "#8C7355", borderRadius: "50%", animation: "assistantBounce 1.4s infinite", animationDelay: "0.4s" }} />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {(error || voiceError) && (
        <div style={{ padding: "0 12px", fontSize: 11, color: "#EF4444", flexShrink: 0 }}>{error ?? voiceError}</div>
      )}

      <div style={{ padding: 12, borderTop: "1px solid #E5DFD5", display: "flex", gap: 6, flexShrink: 0 }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={placeholder}
          style={{
            flex: 1,
            padding: "8px 12px",
            border: "1px solid #E5DFD5",
            borderRadius: 6,
            fontSize,
            fontFamily: "var(--font-sans)",
            color: "#1C1C1E",
            boxSizing: "border-box",
          }}
        />
        {voiceSupported && (
          <button
            onClick={toggleVoiceInput}
            title={isRecording ? "Остановить запись" : "Голосовой ввод"}
            style={{
              width: 32, height: 32,
              background: isRecording ? "#EF4444" : "#F5F3EF",
              border: "1px solid #E5DFD5", borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: isRecording ? "#fff" : "#6B6058",
              flexShrink: 0, transition: "all 0.2s",
            }}
          >
            <Mic size={14} />
          </button>
        )}
        <button
          onClick={handleSend}
          disabled={isLoading}
          style={{
            width: 32, height: 32,
            background: "#2D6A5C", border: "none", borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: isLoading ? "not-allowed" : "pointer", color: "#fff",
            opacity: isLoading ? 0.6 : 1, transition: "all 0.2s",
          }}
        >
          <Send size={14} />
        </button>
      </div>

      <style>{`
        @keyframes assistantBounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}

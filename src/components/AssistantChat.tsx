"use client";
import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Send, Mic, Check, X as XIcon } from "lucide-react";

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
}

interface PendingAction {
  tool: string;
  arguments: Record<string, unknown>;
  description: string;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

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
            ...data.messages.map((m: { role: "user" | "assistant"; text: string }, i: number) => ({
              id: `h-${i}`,
              role: m.role,
              text: m.text,
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
      } else {
        setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: "assistant", text: data.message }]);
      }
      if (data.agent_session_id) setAgentSessionId(data.agent_session_id);
    } catch {
      setError("Не удалось связаться с сервером");
    } finally {
      setIsLoading(false);
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          flex: 1,
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
            style={{ display: "flex", justifyContent: msg.role === "assistant" ? "flex-start" : "flex-end" }}
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
        <div style={{ padding: "0 12px", fontSize: 11, color: "#EF4444" }}>{error ?? voiceError}</div>
      )}

      <div style={{ padding: 12, borderTop: "1px solid #E5DFD5", display: "flex", gap: 6 }}>
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

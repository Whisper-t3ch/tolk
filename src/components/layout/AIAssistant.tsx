"use client";
import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, X, Mic } from "lucide-react";

// Web Speech API не имеет официальных типов в TS lib.dom — минимальный
// набросок нужных полей, чтобы не тащить сторонний пакет ради одного use case.
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

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export default function AIAssistant() {
  const pathname = usePathname();
  // На странице чата с клиентами плавающий кружок мешает панели ввода —
  // там ассистент вызывается из самого чата, а не глобальным виджетом.
  const hideFloatingButton = pathname?.startsWith("/clients");

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const voiceSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

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

  // Позволяет открыть тот же чат-ассистент из любой точки приложения
  // (например, с кнопки-блока в конце страницы /clients), не дублируя логику.
  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("tolk:open-assistant", handler);
    return () => window.removeEventListener("tolk:open-assistant", handler);
  }, []);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([
        {
          id: "1",
          role: "assistant",
          text: "Привет! Я твой помощник. Помогу тебе с анализом сессий, планированием и советами по работе с клиентами.",
        },
      ]);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Show welcome toast after 10 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isOpen && !hideFloatingButton) {
        setShowToast(true);
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [isOpen, hideFloatingButton]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      text: input,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        text: "Интересное наблюдение. На основе записей клиента я вижу, что это может быть связано с... (На данный момент это демо. Полная интеграция с ИИ будет на бэкенде)",
      };
      setMessages(prev => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 1000);
  };

  return (
    <>
      {/* Welcome Toast */}
      <AnimatePresence>
        {showToast && !hideFloatingButton && (
          <motion.div
            initial={{ opacity: 0, y: 20, x: 20 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: 20, x: 20 }}
            style={{
              position: "fixed",
              bottom: 160,
              right: 24,
              background: "#FFFFFF",
              borderRadius: 12,
              border: "1px solid #E5DFD5",
              padding: 16,
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
              zIndex: 45,
              maxWidth: 280,
            }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  background: "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                <Sparkles size={16} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E", marginBottom: 4 }}>
                  Чем я могу помочь?
                </div>
                <p style={{ fontSize: 12, color: "#6B6058", margin: "0 0 12px 0", lineHeight: 1.4 }}>
                  Спросите о техниках, сессиях или планировании работы
                </p>
                <button
                  onClick={() => {
                    setIsOpen(true);
                    setShowToast(false);
                  }}
                  style={{
                    background: "#2D6A5C",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#1F4E43")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#2D6A5C")}
                >
                  Открыть чат
                </button>
              </div>
              <button
                onClick={() => setShowToast(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#8C7355",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Кнопка-круг (скрыта на странице чата с клиентами — там своя точка входа) */}
      {!hideFloatingButton && (
        <motion.button
          onClick={() => setIsOpen(true)}
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "#fff",
            boxShadow: "0 4px 12px rgba(45, 106, 92, 0.35)",
            zIndex: 50,
          }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
        >
          <Sparkles size={24} />
        </motion.button>
      )}

      {/* Модальное окно чата */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Фон */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.3)",
                zIndex: 40,
              }}
            />

            {/* Панель чата */}
            <motion.div
              initial={{ x: 400, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 400, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              style={{
                position: "fixed",
                right: 0,
                top: 0,
                bottom: 0,
                width: "380px",
                background: "linear-gradient(180deg, #E8F2EF 0%, #E6F7F2 100%)",
                boxShadow: "-4px 0 16px rgba(0, 0, 0, 0.1)",
                display: "flex",
                flexDirection: "column",
                zIndex: 45,
              }}
            >
              {/* Заголовок */}
              <div
                style={{
                  padding: "16px",
                  borderBottom: "1px solid #E5DFD5",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      background: "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                    }}
                  >
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E" }}>
                      Помощник
                    </div>
                    <div style={{ fontSize: 10, color: "#1BAF7A" }}>онлайн</div>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#8C7355",
                    padding: 4,
                  }}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Сообщения */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "12px",
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
                    style={{
                      display: "flex",
                      justifyContent: msg.role === "assistant" ? "flex-start" : "flex-end",
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "80%",
                        padding: "8px 12px",
                        borderRadius: 8,
                        background: msg.role === "assistant" ? "#F5F3EF" : "#2D6A5C",
                        color: msg.role === "assistant" ? "#1C1C1E" : "#fff",
                        fontSize: 12,
                        lineHeight: "1.4",
                      }}
                    >
                      {msg.text}
                    </div>
                  </motion.div>
                ))}
                {isLoading && (
                  <div style={{ display: "flex", gap: 4 }}>
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        background: "#8C7355",
                        borderRadius: "50%",
                        animation: "bounce 1.4s infinite",
                      }}
                    />
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        background: "#8C7355",
                        borderRadius: "50%",
                        animation: "bounce 1.4s infinite",
                        animationDelay: "0.2s",
                      }}
                    />
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        background: "#8C7355",
                        borderRadius: "50%",
                        animation: "bounce 1.4s infinite",
                        animationDelay: "0.4s",
                      }}
                    />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Инпут */}
              {voiceError && (
                <div style={{ padding: "0 12px", fontSize: 11, color: "#EF4444" }}>
                  {voiceError}
                </div>
              )}
              <div
                style={{
                  padding: "12px",
                  borderTop: "1px solid #E5DFD5",
                  display: "flex",
                  gap: 6,
                }}
              >
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyPress={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Спроси меня..."
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    border: "1px solid #E5DFD5",
                    borderRadius: 6,
                    fontSize: 12,
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
                      width: 32,
                      height: 32,
                      background: isRecording ? "#EF4444" : "#F5F3EF",
                      border: "1px solid #E5DFD5",
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      color: isRecording ? "#fff" : "#6B6058",
                      flexShrink: 0,
                      transition: "all 0.2s",
                    }}
                  >
                    <Mic size={14} />
                  </button>
                )}
                <button
                  onClick={handleSend}
                  disabled={isLoading}
                  style={{
                    width: 32,
                    height: 32,
                    background: "#2D6A5C",
                    border: "none",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: isLoading ? "not-allowed" : "pointer",
                    color: "#fff",
                    opacity: isLoading ? 0.6 : 1,
                    transition: "all 0.2s",
                  }}
                >
                  <Send size={14} />
                </button>
              </div>

              <style>{`
                @keyframes bounce {
                  0%, 80%, 100% {
                    transform: translateY(0);
                  }
                  40% {
                    transform: translateY(-8px);
                  }
                }
              `}</style>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

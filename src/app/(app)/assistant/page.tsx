"use client";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, Loader } from "lucide-react";
import { clients, assistantReplies } from "@/lib/mock-data";
import { Button, Card, CardContent, Input } from "@/components/ui";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
}

function getReply(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("задани") || m.includes("дз") || m.includes("домашн"))
    return assistantReplies.homework;
  if (m.includes("триггер") || m.includes("причин") || m.includes("провоцир"))
    return assistantReplies.triggers;
  if (m.includes("динамик") || m.includes("прогресс") || m.includes("gad") || m.includes("тест"))
    return assistantReplies.dynamic;
  if (m.includes("пост") || m.includes("контент") || m.includes("telegram"))
    return assistantReplies.post;
  return assistantReplies.default;
}

const INITIAL_MESSAGES: Message[] = [
  {
    id: "init",
    role: "assistant",
    text: "Привет, Мария! Я загрузил контекст по всем вашим клиентам. Спросите меня о любом: триггерах, динамике тестов, домашних заданиях или идеях для контента.",
    time: "сейчас",
  },
];

export default function AssistantPage() {
  const [activeClient, setActiveClient] = useState(clients[0]);
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  function send() {
    if (!input.trim() || typing) return;
    const now = new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
    const userMsg: Message = { id: Date.now().toString(), role: "user", text: input, time: now };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setTyping(true);

    setTimeout(() => {
      const reply = getReply(userMsg.text);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        text: reply,
        time: new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }),
      }]);
      setTyping(false);
    }, 1400 + Math.random() * 600);
  }

  return (
    <div style={{ display: "flex", height: "calc(100vh - 120px)", gap: 16, padding: "0 24px 24px" }}>
      {/* Панель выбора клиента */}
      <div style={{ width: 220, flexShrink: 0 }}>
        <Card>
          <CardContent className="pt-6">
            <p style={{ fontSize: 11, fontWeight: 600, color: "#6B6058", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
              Контекст клиента
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {clients.map((c, i) => (
                <motion.button
                  key={c.id}
                  onClick={() => setActiveClient(c)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px",
                    background: activeClient.id === c.id ? "#E8F2EF" : "transparent",
                    border: activeClient.id === c.id ? "1px solid #2D6A5C" : "1px solid transparent",
                    borderRadius: 10, textAlign: "left",
                    transition: "all 0.15s ease",
                    cursor: "pointer",
                    fontSize: 13,
                    fontFamily: "var(--font-sans)",
                    color: activeClient.id === c.id ? "#2D6A5C" : "#1C1C1E",
                    fontWeight: activeClient.id === c.id ? 600 : 400,
                  }}
                >
                  <div style={{
                    width: 32, height: 32,
                    background: ["#2D6A5C", "#1BAF7A", "#F59E0B"][i % 3],
                    borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 600, color: "#fff", flexShrink: 0,
                  }}>{c.initials}</div>
                  <div style={{ overflow: "hidden" }}>
                    <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.request}
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Чат */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Card className="flex-1 flex flex-col">
          <CardContent className="flex-1 overflow-y-auto pt-6 flex flex-col" style={{ minHeight: 0 }}>
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  style={{
                    marginBottom: 12,
                    display: "flex",
                    justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  }}
                >
                  <div style={{
                    maxWidth: "70%",
                    padding: "12px 16px",
                    borderRadius: 12,
                    background: msg.role === "user" ? "#2D6A5C" : "#F5F3EF",
                    color: msg.role === "user" ? "#fff" : "#1C1C1E",
                    fontSize: 14,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordWrap: "break-word",
                    overflowWrap: "break-word",
                  }}>
                    <p style={{ margin: 0 }}>{msg.text}</p>
                    <span style={{
                      fontSize: 11,
                      opacity: 0.6,
                      marginTop: 4,
                      display: "block",
                    }}>
                      {msg.time}
                    </span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {typing && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 12 }}
              >
                <div style={{ width: 32, height: 32, background: "#1BAF7A", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Bot size={16} color="#fff" />
                </div>
                <div style={{ display: "flex", gap: 3 }}>
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      animate={{ y: [0, -4, 0] }}
                      transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                      style={{
                        width: 8, height: 8,
                        background: "#1BAF7A",
                        borderRadius: "50%",
                      }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </CardContent>
        </Card>

        {/* Инпут */}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Input
            placeholder="Напишите ваш вопрос..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyPress={e => e.key === "Enter" && send()}
            disabled={typing}
          />
          <Button onClick={send} disabled={typing || !input.trim()} size="md">
            {typing ? <Loader size={14} /> : <Send size={14} />}
          </Button>
        </div>
      </div>
    </div>
  );
}

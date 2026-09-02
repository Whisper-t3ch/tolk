"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui";
import { useClients } from "@/lib/ClientsContext";
import AssistantChat from "@/components/AssistantChat";

export default function AssistantPage() {
  const { clients, loading: clientsLoading } = useClients();
  const [activeClientId, setActiveClientId] = useState<string | undefined>(undefined);

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
              <motion.button
                onClick={() => setActiveClientId(undefined)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px",
                  background: activeClientId === undefined ? "#E8F2EF" : "transparent",
                  border: activeClientId === undefined ? "1px solid #2D6A5C" : "1px solid transparent",
                  borderRadius: 10, textAlign: "left",
                  transition: "all 0.15s ease",
                  cursor: "pointer",
                  fontSize: 13,
                  fontFamily: "var(--font-sans)",
                  color: activeClientId === undefined ? "#2D6A5C" : "#1C1C1E",
                  fontWeight: activeClientId === undefined ? 600 : 400,
                }}
              >
                Без привязки к клиенту
              </motion.button>
              {clientsLoading && (
                <p style={{ fontSize: 12, color: "#8C7355", padding: "10px 12px" }}>Загрузка клиентов…</p>
              )}
              {clients.map((c, i) => (
                <motion.button
                  key={c.id}
                  onClick={() => setActiveClientId(c.id)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px",
                    background: activeClientId === c.id ? "#E8F2EF" : "transparent",
                    border: activeClientId === c.id ? "1px solid #2D6A5C" : "1px solid transparent",
                    borderRadius: 10, textAlign: "left",
                    transition: "all 0.15s ease",
                    cursor: "pointer",
                    fontSize: 13,
                    fontFamily: "var(--font-sans)",
                    color: activeClientId === c.id ? "#2D6A5C" : "#1C1C1E",
                    fontWeight: activeClientId === c.id ? 600 : 400,
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

      {/* Чат — реальная интеграция с /api/assistant (function calling, RAG, подтверждения) */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Card className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
          {/* key пересоздаёт чат при смене клиента — старая история другого контекста не должна путать модель */}
          <AssistantChat key={activeClientId ?? "no-client"} clientId={activeClientId} compact={false} placeholder="Напишите ваш вопрос..." />
        </Card>
      </div>
    </div>
  );
}

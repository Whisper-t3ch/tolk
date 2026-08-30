"use client";
import { motion } from "framer-motion";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Calendar, Clock, ArrowRight, Video, Link2, Check } from "lucide-react";
import { useSession, type PlannedSession } from "@/lib/SessionContext";
import { useClients } from "@/lib/ClientsContext";
import { Button, Card, CardContent } from "@/components/ui";

const avatarColors = ["#2D6A5C", "#1BAF7A", "#F59E0B", "#EF4444", "#8B5CF6"];

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("ru", { day: "numeric", month: "long", weekday: "long" });
}

export default function SessionsPage() {
  const { sessions, confirmPayment } = useSession();
  const { clients } = useClients();
  const [filter, setFilter] = useState<"upcoming" | "past">("upcoming");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function handleConfirmPayment(sessionId: string) {
    setConfirmingId(sessionId);
    try {
      await confirmPayment(sessionId);
    } finally {
      setConfirmingId(null);
    }
  }

  function clientIndex(clientId: string) {
    const idx = clients.findIndex(c => c.id === clientId);
    return idx === -1 ? 0 : idx;
  }

  const today = "2026-08-16";

  const { upcoming, past } = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return {
      upcoming: sorted.filter(s => s.date >= today),
      past: sorted.filter(s => s.date < today).reverse(),
    };
  }, [sessions]);

  const list = filter === "upcoming" ? upcoming : past;

  const groups = useMemo(() => {
    const map = new Map<string, PlannedSession[]>();
    for (const s of list) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    return Array.from(map.entries());
  }, [list]);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.5px" }}>
          Сессии
        </h1>
        <p style={{ fontSize: 14, color: "#6B6058", marginTop: 6 }}>
          Все запланированные и прошедшие встречи с клиентами
        </p>
      </div>

      {/* Фильтр */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {([
          { id: "upcoming" as const, label: `Предстоящие (${upcoming.length})` },
          { id: "past" as const, label: `Прошедшие (${past.length})` },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            style={{
              padding: "8px 16px",
              background: filter === tab.id ? "#2D6A5C" : "#FFFFFF",
              color: filter === tab.id ? "#FFFFFF" : "#6B6058",
              border: filter === tab.id ? "none" : "1px solid #E5DFD5",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {groups.length === 0 && (
        <div style={{
          textAlign: "center",
          padding: "60px 24px",
          background: "#FFFFFF",
          borderRadius: 12,
          border: "1px solid #E5DFD5",
        }}>
          <Calendar size={32} style={{ color: "#8C7355", marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: "#6B6058" }}>
            {filter === "upcoming" ? "Нет запланированных сессий" : "Пока нет прошедших сессий"}
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {groups.map(([date, sessionsOnDate]) => (
          <div key={date}>
            <h3 style={{
              fontSize: 12, fontWeight: 700, color: "#8C7355",
              textTransform: "capitalize", marginBottom: 10,
            }}>
              {date === today ? "Сегодня" : formatDateLabel(date)}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {sessionsOnDate.map((session, i) => {
                const idx = clientIndex(session.clientId);
                const client = clients[idx];
                return (
                  <motion.div
                    key={session.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <Card>
                      <CardContent style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                        <div style={{
                          display: "flex", flexDirection: "column", alignItems: "center",
                          minWidth: 56, flexShrink: 0,
                        }}>
                          <Clock size={14} style={{ color: "#2D6A5C", marginBottom: 2 }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E" }}>{session.time}</span>
                        </div>

                        <Link href={`/clients/${session.clientId}`} style={{ textDecoration: "none", flex: "1 1 180px", minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", minWidth: 0 }}>
                            <div style={{
                              width: 40, height: 40,
                              background: avatarColors[idx % avatarColors.length],
                              borderRadius: "50%",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0,
                            }}>
                              {client?.initials ?? "?"}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span style={{
                                  fontSize: 14, fontWeight: 600, color: "#1C1C1E",
                                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                }}>
                                  {session.clientName}
                                </span>
                                {session.bookedVia === "public_link" && (
                                  <span style={{
                                    display: "inline-flex", alignItems: "center", gap: 3,
                                    fontSize: 10.5, fontWeight: 700, color: "#8B5CF6",
                                    background: "#F1EBFE", padding: "2px 7px", borderRadius: 20,
                                    flexShrink: 0,
                                  }}>
                                    <Link2 size={10} /> Забронировано клиентом
                                  </span>
                                )}
                              </div>
                              {client && (
                                <div style={{
                                  fontSize: 12, color: "#8C7355",
                                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                }}>{client.request}</div>
                              )}
                            </div>
                          </div>
                        </Link>

                        {session.status === "pending_payment" ? (
                          <Button
                            size="sm"
                            onClick={() => handleConfirmPayment(session.id)}
                            disabled={confirmingId === session.id}
                          >
                            <Check size={14} style={{ marginRight: 6 }} />
                            {confirmingId === session.id ? "Подтверждаю..." : "Подтвердить оплату"}
                          </Button>
                        ) : filter === "upcoming" ? (
                          <Link href={`/session/${session.clientId}`} style={{ textDecoration: "none", flexShrink: 0 }}>
                            <Button size="sm">
                              Начать <ArrowRight size={14} style={{ marginLeft: 6 }} />
                            </Button>
                          </Link>
                        ) : (
                          <Link href={`/clients/${session.clientId}`} style={{ textDecoration: "none", flexShrink: 0 }}>
                            <Button variant="secondary" size="sm">
                              <Video size={14} style={{ marginRight: 6 }} />
                              Карточка
                            </Button>
                          </Link>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

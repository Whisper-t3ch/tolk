"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSession } from "@/lib/SessionContext";
import { Card, CardContent, Button } from "@/components/ui";

type SessionsByDay = Record<number, Array<{ clientId: string; clientName: string; time: string }>>;

function getSessionsByDay(sessions: any[], month: number, year: number): SessionsByDay {
  const result: SessionsByDay = {};

  sessions.forEach(session => {
    const [y, m, d] = session.date.split('-').map(Number);
    if (y === year && m === month + 1) {
      if (!result[d]) result[d] = [];
      result[d].push({
        clientId: session.clientId,
        clientName: session.clientName,
        time: session.time,
      });
    }
  });

  return result;
}

const avatarColors: Record<string, string> = {
  "1": "#2D6A5C",
  "2": "#1BAF7A",
  "3": "#F59E0B",
};

export default function CalendarPage() {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today);
  const { sessions } = useSession();
  const sessionsByDay = getSessionsByDay(sessions, currentMonth.getMonth(), currentMonth.getFullYear());

  const monthNames = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
  ];

  const getDaysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();

  const daysInMonth = getDaysInMonth(currentMonth);
  const firstDay = getFirstDayOfMonth(currentMonth);
  const days = [];

  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1C1C1E", marginBottom: 24 }}>
        Календарь сессий
      </h1>

      <Card>
        <CardContent className="pt-6">
          {/* Навигация по месяцам */}
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 24,
          }}>
            <Button onClick={prevMonth} variant="secondary" size="sm">
              <ChevronLeft size={16} />
            </Button>
            <h2 style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#1C1C1E",
              margin: 0,
            }}>
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </h2>
            <Button onClick={nextMonth} variant="secondary" size="sm">
              <ChevronRight size={16} />
            </Button>
          </div>

          {/* Дни недели */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 8,
            marginBottom: 16,
          }}>
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
              <div
                key={day}
                style={{
                  textAlign: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#8C7355",
                  paddingBottom: 8,
                }}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Календарь */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 8,
          }}>
            {days.map((day, idx) => {
              const hasSessions = day && sessionsByDay[day];
              const isToday = day === today.getDate() && currentMonth.getMonth() === today.getMonth();

              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.02 }}
                  style={{
                    minHeight: 100,
                    padding: 8,
                    background: isToday ? "#E8F2EF" : day ? "#FFFFFF" : "#F5F3EF",
                    border: isToday ? "2px solid #2D6A5C" : "1px solid #E5DFD5",
                    borderRadius: 8,
                    cursor: hasSessions ? "pointer" : "default",
                    transition: "all 0.2s",
                  }}
                  whileHover={hasSessions ? { y: -2, boxShadow: "0 8px 16px rgba(79, 126, 255, 0.15)" } : {}}
                >
                  {day && (
                    <>
                      <div style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: isToday ? "#2D6A5C" : "#1C1C1E",
                        marginBottom: 6,
                      }}>
                        {day}
                      </div>

                      {hasSessions && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {sessionsByDay[day].map((session, i) => (
                            <Link
                              key={i}
                              href={`/clients/${session.clientId}`}
                              style={{ textDecoration: "none" }}
                            >
                              <motion.div
                                whileHover={{ scale: 1.05 }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "4px 6px",
                                  background: `${avatarColors[session.clientId]}20`,
                                  borderRadius: 4,
                                  cursor: "pointer",
                                }}
                              >
                                <div style={{
                                  width: 16,
                                  height: 16,
                                  background: avatarColors[session.clientId],
                                  borderRadius: "50%",
                                  flexShrink: 0,
                                }} />
                                <div>
                                  <div style={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    color: avatarColors[session.clientId],
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}>
                                    {session.clientName}
                                  </div>
                                  <div style={{
                                    fontSize: 9,
                                    color: "#8C7355",
                                  }}>
                                    {session.time}
                                  </div>
                                </div>
                              </motion.div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </motion.div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Легенда */}
      <Card style={{ marginTop: 24 }}>
        <CardContent className="pt-6">
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 12 }}>
            📌 Информация
          </h3>
          <p style={{ fontSize: 13, color: "#6B6058", margin: 0 }}>
            Кликните на день с сессией чтобы перейти на страницу клиента. Синяя граница показывает текущий день.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

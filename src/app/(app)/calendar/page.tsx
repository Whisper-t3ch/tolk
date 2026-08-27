"use client";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { ChevronLeft, ChevronRight, X, Video, Clock } from "lucide-react";
import { useSession } from "@/lib/SessionContext";
import { Card, CardContent, Button } from "@/components/ui";

// ------------------------------------------------------------
// Личные дела — демонстрационная заглушка (для показа на созвоне).
// Пока не хранятся в Supabase: отдельная предметная область "личный
// календарь психолога", ещё не спроектирована как таблица. День
// считается от текущей даты, чтобы всегда попадать в открытый месяц.
// Расписание сделано плотным (почти каждый день) — утренний ритуал,
// приёмы пищи, активности между сессиями — чтобы день выглядел как
// реальный рабочий день психолога, а не пустая сетка с парой пунктов.
// ------------------------------------------------------------
interface PersonalEvent {
  dayOffset: number; // относительно today, может уйти в соседний месяц
  time: string;
  title: string;
  emoji: string;
}

const DAILY_TEMPLATES: Omit<PersonalEvent, "dayOffset">[][] = [
  [
    { time: "07:00", title: "Йога", emoji: "🧘" },
    { time: "08:00", title: "Завтрак", emoji: "🥣" },
    { time: "13:00", title: "Обед", emoji: "🍲" },
    { time: "18:30", title: "Прогулка в парке", emoji: "🌳" },
  ],
  [
    { time: "07:30", title: "Зал", emoji: "🏋️" },
    { time: "08:30", title: "Завтрак", emoji: "🥣" },
    { time: "13:00", title: "Обед", emoji: "🍲" },
    { time: "19:00", title: "Ужин с семьёй", emoji: "🍽️" },
  ],
  [
    { time: "07:00", title: "Медитация", emoji: "🧘‍♂️" },
    { time: "08:00", title: "Завтрак", emoji: "🥣" },
    { time: "12:30", title: "Обед", emoji: "🍲" },
    { time: "17:00", title: "Супервизия", emoji: "🧑‍⚕️" },
  ],
  [
    { time: "07:30", title: "Пробежка", emoji: "🏃" },
    { time: "08:30", title: "Завтрак", emoji: "🥣" },
    { time: "13:00", title: "Обед", emoji: "🍲" },
    { time: "18:00", title: "Прогулка с ребёнком", emoji: "🚶" },
  ],
  [
    { time: "07:00", title: "Йога", emoji: "🧘" },
    { time: "08:00", title: "Завтрак", emoji: "🥣" },
    { time: "13:00", title: "Обед", emoji: "🍲" },
    { time: "20:00", title: "Кино с женой", emoji: "🎬" },
  ],
  [
    { time: "09:00", title: "Врач", emoji: "🩺" },
    { time: "10:00", title: "Завтрак поздний", emoji: "🥐" },
    { time: "14:00", title: "Обед", emoji: "🍲" },
  ],
  [
    { time: "10:00", title: "Завтрак", emoji: "🥞" },
    { time: "12:00", title: "Время с семьёй", emoji: "👨‍👩‍👧" },
    { time: "19:00", title: "Настольные игры", emoji: "🎲" },
  ],
];

// Дни без личных дел вообще (0 = сегодня) — чтобы не выглядело неестественно идеально.
const SKIP_OFFSETS = new Set<number>([5, 12, 19, 26]);

function buildPersonalEvents(): PersonalEvent[] {
  const events: PersonalEvent[] = [];
  for (let offset = -3; offset <= 35; offset++) {
    if (SKIP_OFFSETS.has(((offset % 7) + 7) % 7)) continue;
    const template = DAILY_TEMPLATES[((offset % DAILY_TEMPLATES.length) + DAILY_TEMPLATES.length) % DAILY_TEMPLATES.length];
    template.forEach(evt => events.push({ ...evt, dayOffset: offset }));
  }
  return events;
}

const PERSONAL_EVENTS: PersonalEvent[] = buildPersonalEvents();

function getPersonalEventsByDay(month: number, year: number): Record<number, PersonalEvent[]> {
  const today = new Date();
  const result: Record<number, PersonalEvent[]> = {};
  PERSONAL_EVENTS.forEach(evt => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + evt.dayOffset);
    if (d.getMonth() === month && d.getFullYear() === year) {
      const day = d.getDate();
      if (!result[day]) result[day] = [];
      result[day].push(evt);
    }
  });
  return result;
}

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

const clientColors = ["#2D6A5C", "#1BAF7A", "#F59E0B", "#EF4444", "#8B5CF6", "#0EA5E9"];
function colorForClient(clientId: string): string {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) hash = (hash * 31 + clientId.charCodeAt(i)) >>> 0;
  return clientColors[hash % clientColors.length];
}

// Унифицированная запись дня для боковой панели — сессии и личные дела
// вместе, отсортированные по времени, со скроллом если их много.
interface DayEntry {
  time: string;
  kind: "session" | "personal";
  title: string;
  subtitle?: string;
  emoji?: string;
  color?: string;
  clientId?: string;
}

const MAX_PREVIEW_ITEMS = 3;

export default function CalendarPage() {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const { sessions } = useSession();
  const sessionsByDay = getSessionsByDay(sessions, currentMonth.getMonth(), currentMonth.getFullYear());
  const personalEventsByDay = getPersonalEventsByDay(currentMonth.getMonth(), currentMonth.getFullYear());

  const monthNames = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
  ];

  const getDaysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (date: Date) => {
    const jsDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
    return jsDay === 0 ? 6 : jsDay - 1; // Пн = 0 ... Вс = 6
  };

  const daysInMonth = getDaysInMonth(currentMonth);
  const firstDay = getFirstDayOfMonth(currentMonth);
  const days: (number | null)[] = [];

  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
    setSelectedDay(null);
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
    setSelectedDay(null);
  };

  const selectedDayEntries: DayEntry[] = useMemo(() => {
    if (selectedDay === null) return [];
    const entries: DayEntry[] = [];
    (sessionsByDay[selectedDay] ?? []).forEach(s => {
      entries.push({
        time: s.time,
        kind: "session",
        title: s.clientName,
        subtitle: "Сессия",
        color: colorForClient(s.clientId),
        clientId: s.clientId,
      });
    });
    (personalEventsByDay[selectedDay] ?? []).forEach(evt => {
      entries.push({ time: evt.time, kind: "personal", title: evt.title, emoji: evt.emoji });
    });
    return entries.sort((a, b) => a.time.localeCompare(b.time));
  }, [selectedDay, sessionsByDay, personalEventsByDay]);

  const selectedDate =
    selectedDay !== null
      ? new Date(currentMonth.getFullYear(), currentMonth.getMonth(), selectedDay)
      : null;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", position: "relative" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1C1C1E", marginBottom: 24 }}>
        Календарь
      </h1>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
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
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
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
                  const daySessions = day ? sessionsByDay[day] ?? [] : [];
                  const dayPersonal = day ? personalEventsByDay[day] ?? [] : [];
                  const totalCount = daySessions.length + dayPersonal.length;
                  const isToday = day === today.getDate() && currentMonth.getMonth() === today.getMonth() && currentMonth.getFullYear() === today.getFullYear();
                  const isSelected = day !== null && day === selectedDay;

                  // Превью: сначала сессии (важнее), потом личные дела, максимум MAX_PREVIEW_ITEMS.
                  const previewEntries: DayEntry[] = [
                    ...daySessions.map(s => ({
                      time: s.time, kind: "session" as const, title: s.clientName, color: colorForClient(s.clientId),
                    })),
                    ...dayPersonal.map(evt => ({
                      time: evt.time, kind: "personal" as const, title: evt.title, emoji: evt.emoji,
                    })),
                  ].sort((a, b) => a.time.localeCompare(b.time));
                  const shown = previewEntries.slice(0, MAX_PREVIEW_ITEMS);
                  const hiddenCount = totalCount - shown.length;

                  return (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: idx * 0.01 }}
                      onClick={() => day && setSelectedDay(day)}
                      style={{
                        minHeight: 104,
                        padding: 8,
                        background: isSelected ? "#E8F2EF" : isToday ? "#F5FAF8" : day ? "#FFFFFF" : "#F5F3EF",
                        border: isSelected ? "2px solid #2D6A5C" : isToday ? "1.5px solid #2D6A5C" : "1px solid #E5DFD5",
                        borderRadius: 8,
                        cursor: day ? "pointer" : "default",
                        transition: "all 0.2s",
                      }}
                      whileHover={day ? { y: -2, boxShadow: "0 8px 16px rgba(45,106,92,0.12)" } : {}}
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

                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            {shown.map((entry, i) => (
                              <div
                                key={i}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "2px 5px",
                                  borderRadius: 4,
                                  background: entry.kind === "session" ? `${entry.color}20` : "#F5F3EF",
                                  border: entry.kind === "personal" ? "1px dashed #D8CFC0" : "none",
                                }}
                              >
                                {entry.kind === "session" ? (
                                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: entry.color, flexShrink: 0 }} />
                                ) : (
                                  <span style={{ fontSize: 9 }}>{entry.emoji}</span>
                                )}
                                <span style={{
                                  fontSize: 9.5,
                                  fontWeight: entry.kind === "session" ? 600 : 400,
                                  color: entry.kind === "session" ? entry.color : "#8C7355",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}>
                                  {entry.title}
                                </span>
                              </div>
                            ))}
                            {hiddenCount > 0 && (
                              <div style={{ fontSize: 9.5, color: "#8C7355", fontWeight: 600, paddingLeft: 5 }}>
                                ещё {hiddenCount}
                              </div>
                            )}
                          </div>
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
                Кликните на число, чтобы открыть все события дня. Сплошная граница — текущий день. Пунктирные карточки — личные дела (зал, семья, врач и т.д.).
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Боковая панель дня — со скроллом, если событий много */}
        <AnimatePresence>
          {selectedDay !== null && (
            <motion.div
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              style={{ width: 300, flexShrink: 0 }}
            >
              <Card style={{ position: "sticky", top: 16 }}>
                <CardContent className="pt-6" style={{ display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 140px)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
                      {selectedDate?.toLocaleDateString("ru", { day: "numeric", month: "long" })}
                    </h3>
                    <button
                      onClick={() => setSelectedDay(null)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#8C7355", padding: 4 }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <p style={{ fontSize: 12, color: "#8C7355", margin: "0 0 16px 0" }}>
                    {selectedDayEntries.length === 0
                      ? "Событий нет"
                      : `${selectedDayEntries.length} ${selectedDayEntries.length === 1 ? "событие" : "событий"}`}
                  </p>

                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    overflowY: "auto",
                    paddingRight: 4,
                  }}>
                    {selectedDayEntries.map((entry, i) => {
                      const content = (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 10,
                            padding: "10px 12px",
                            borderRadius: 8,
                            background: entry.kind === "session" ? `${entry.color}14` : "#F5F3EF",
                            border: entry.kind === "session" ? `1px solid ${entry.color}40` : "1px dashed #D8CFC0",
                            cursor: entry.kind === "session" ? "pointer" : "default",
                          }}
                        >
                          <div style={{
                            display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                            fontSize: 11.5, fontWeight: 700, color: entry.kind === "session" ? entry.color : "#8C7355",
                            minWidth: 42,
                          }}>
                            <Clock size={11} />
                            {entry.time}
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{
                              fontSize: 13, fontWeight: 600, color: "#1C1C1E",
                              display: "flex", alignItems: "center", gap: 6,
                            }}>
                              {entry.kind === "personal" && <span>{entry.emoji}</span>}
                              {entry.title}
                              {entry.kind === "session" && <Video size={12} style={{ color: entry.color, opacity: 0.7 }} />}
                            </div>
                            {entry.subtitle && (
                              <div style={{ fontSize: 11, color: "#8C7355", marginTop: 2 }}>{entry.subtitle}</div>
                            )}
                          </div>
                        </div>
                      );
                      return entry.kind === "session" && entry.clientId ? (
                        <Link key={i} href={`/clients/${entry.clientId}`} style={{ textDecoration: "none" }}>
                          {content}
                        </Link>
                      ) : (
                        <div key={i}>{content}</div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

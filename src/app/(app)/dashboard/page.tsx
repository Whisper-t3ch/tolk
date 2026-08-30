"use client";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useSession } from "@/lib/SessionContext";
import { useClients } from "@/lib/ClientsContext";
import { usePersonalEvents } from "@/lib/PersonalEventsContext";
import { findNearestFreeSlot } from "@/lib/calendarSlots";
import { getScoreColor, getScoreBg } from "@/lib/utils";
import { Users, Video, UserPlus, AlertCircle, ArrowRight, Clock, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";

const avatarColors = ["#2D6A5C", "#1BAF7A", "#F59E0B", "#EF4444", "#8B5CF6"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const EMPTY_LAST_TEST = { name: "—", score: 0, maxScore: 1, date: "—" };

function toDateStr(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Реальная сегодняшняя дата в формате YYYY-MM-DD (локальная, не UTC —
// иначе после полуночи по UTC "сегодня" на дашборде могло бы отличаться
// от календарной даты у психолога).
function todayDateStr() {
  const now = new Date();
  return toDateStr(now.getFullYear(), now.getMonth(), now.getDate());
}

export default function DashboardPage() {
  const [hoveredClient, setHoveredClient] = useState<string | null>(null);
  const { sessions } = useSession();
  const { clients } = useClients();
  const { events: personalEvents, updateEventTime } = usePersonalEvents();
  // Вычисляем один раз при монтировании — стабильно на протяжении жизни
  // страницы, чтобы "сегодня" не съезжало ровно в полночь во время сессии.
  const [TODAY] = useState(todayDateStr);

  function clientIndex(clientId: string) {
    const idx = clients.findIndex(c => c.id === clientId);
    return idx === -1 ? 0 : idx;
  }

  const sessionCountByClient = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach(s => map.set(s.clientId, (map.get(s.clientId) ?? 0) + 1));
    return map;
  }, [sessions]);
  const todayDate = new Date(TODAY + "T00:00:00");
  const [viewMonth, setViewMonth] = useState(new Date(todayDate.getFullYear(), todayDate.getMonth(), 1));
  const [selectedDateStr, setSelectedDateStr] = useState(TODAY);

  const monthNames = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
  ];

  const sessionsByDay = useMemo(() => {
    const map: Record<number, typeof sessions> = {};
    sessions.forEach(s => {
      const [y, m, d] = s.date.split("-").map(Number);
      if (y === viewMonth.getFullYear() && m === viewMonth.getMonth() + 1) {
        if (!map[d]) map[d] = [];
        map[d].push(s);
      }
    });
    return map;
  }, [sessions, viewMonth]);

  const personalEventsByDay = useMemo(() => {
    const map: Record<number, typeof personalEvents> = {};
    personalEvents.forEach(evt => {
      const [y, m, d] = evt.date.split("-").map(Number);
      if (y === viewMonth.getFullYear() && m === viewMonth.getMonth() + 1) {
        if (!map[d]) map[d] = [];
        map[d].push(evt);
      }
    });
    return map;
  }, [personalEvents, viewMonth]);

  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const firstDayRaw = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1).getDay();
  const firstDay = firstDayRaw === 0 ? 6 : firstDayRaw - 1; // понедельник = 0

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const prevMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1));
  const nextMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1));

  const isToday = selectedDateStr === TODAY;

  const sessionsOnDate = useMemo(
    () => sessions.filter(s => s.date === selectedDateStr).sort((a, b) => a.time.localeCompare(b.time)),
    [sessions, selectedDateStr]
  );
  const personalEventsOnDate = useMemo(
    () => personalEvents.filter(e => e.date === selectedDateStr).sort((a, b) => a.time.localeCompare(b.time)),
    [personalEvents, selectedDateStr]
  );

  const selectedDateObj = new Date(selectedDateStr + "T00:00:00");
  const dayLabel = selectedDateObj.toLocaleDateString("ru", { day: "numeric", month: "long", weekday: "long" });

  // Занятые времена выбранного дня — для автосдвига при редактировании времени личного дела.
  const occupiedTimesOnDate = useMemo(
    () => [
      ...sessionsOnDate.map(s => ({ time: s.time })),
      ...personalEventsOnDate.map(e => ({ time: e.time, id: e.id })),
    ],
    [sessionsOnDate, personalEventsOnDate]
  );
  const handleUpdateEventTime = (id: string, requestedTime: string) => {
    const freeTime = findNearestFreeSlot(requestedTime, occupiedTimesOnDate, id);
    updateEventTime(id, freeTime);
  };

  const newClients = useMemo(() => {
    const cutoff = new Date(TODAY + "T00:00:00");
    cutoff.setDate(cutoff.getDate() - 30);
    return clients.filter(c => new Date(c.joinedDate + "T00:00:00") >= cutoff);
  }, [clients]);
  const attentionClients = useMemo(() => clients.filter(c => c.needsAttention), [clients]);
  const activeClients = useMemo(() => clients.filter(c => c.status === "active"), [clients]);
  const sessionsThisMonth = useMemo(() => {
    const [y, m] = TODAY.split("-").map(Number);
    return sessions.filter(s => {
      const [sy, sm] = s.date.split("-").map(Number);
      return sy === y && sm === m;
    }).length;
  }, [sessions]);
  const avgSessionsPerClient = useMemo(() => {
    if (clients.length === 0) return 0;
    const total = clients.reduce((sum, c) => sum + (sessionCountByClient.get(c.id) ?? 0), 0);
    return Math.round(total / clients.length);
  }, [clients, sessionCountByClient]);

  return (
    <div style={{ maxWidth: 1200, width: "100%", margin: "0 auto" }}>
      {/* Заголовок */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.5px" }}>
          Добрый день, Мария
        </h1>
        <p style={{ fontSize: 15, color: "#6B6058", marginTop: 6 }}>
          Сегодня {new Date(TODAY + "T00:00:00").toLocaleDateString("ru", { day: "numeric", month: "long" })} · {sessions.filter(s => s.date === TODAY).length} {sessions.filter(s => s.date === TODAY).length === 1 ? "сессия" : "сессии"}
        </p>
      </div>

      {/* Статистика */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        {[
          { label: "Активных клиентов", value: activeClients.length, icon: Users, color: "#2D6A5C", href: "/clients" },
          { label: "Сессий в месяце", value: sessionsThisMonth, icon: Video, color: "#1BAF7A", href: "/sessions" },
          { label: "Новых клиентов", value: `+${newClients.length}`, icon: UserPlus, color: "#8B5CF6", href: "/clients?filter=new" },
          { label: "Требуют внимания", value: attentionClients.length, icon: AlertCircle, color: "#F59E0B", href: "/clients?filter=attention" },
        ].map(({ label, value, icon: Icon, color, href }, idx) => (
          <Link key={label} href={href} style={{ textDecoration: "none" }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: idx * 0.05 }}
            whileHover={{ y: -4, boxShadow: "0 12px 32px rgba(79, 126, 255, 0.2)" }}
            className="bg-white border border-[#E5DFD5] rounded-lg p-6 shadow-sm hover:shadow-md transition-all cursor-pointer"
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 32, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.5px" }}>
                  {value}
                </div>
                <div style={{ fontSize: 13, color: "#6B6058", marginTop: 6, fontWeight: 500 }}>
                  {label}
                </div>
              </div>
              <motion.div
                whileHover={{ scale: 1.1, rotate: 5 }}
                style={{
                  width: 48, height: 48,
                  background: `${color}20`,
                  borderRadius: 12,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: `2px solid ${color}40`,
                }}
              >
                <Icon size={24} style={{ color }} />
              </motion.div>
            </div>
          </motion.div>
          </Link>
        ))}
      </div>

      {/* Мини-календарь сессий */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
            Сессии
          </h2>
          <div style={{ display: "flex", gap: 16 }}>
            <Link href="/calendar" style={{ fontSize: 13, color: "#6B6058", textDecoration: "none", fontWeight: 600 }}>
              Полный календарь
            </Link>
            <Link href="/sessions" style={{ fontSize: 13, color: "#2D6A5C", textDecoration: "none", fontWeight: 600 }}>
              Все сессии →
            </Link>
          </div>
        </div>

        <Card>
          <CardContent className="pt-5 pb-5">
            <div style={{ display: "flex", gap: 24 }}>
              {/* Сетка месяца */}
              <div style={{ flex: "0 0 340px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <button
                    onClick={prevMonth}
                    style={{
                      width: 28, height: 28, background: "#F5F3EF", border: "1px solid #E5DFD5",
                      borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", color: "#6B6058",
                    }}
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E" }}>
                    {monthNames[viewMonth.getMonth()]} {viewMonth.getFullYear()}
                  </span>
                  <button
                    onClick={nextMonth}
                    style={{
                      width: 28, height: 28, background: "#F5F3EF", border: "1px solid #E5DFD5",
                      borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", color: "#6B6058",
                    }}
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 6 }}>
                  {WEEKDAYS.map(d => (
                    <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#8C7355" }}>
                      {d}
                    </div>
                  ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                  {cells.map((day, idx) => {
                    if (!day) return <div key={idx} />;
                    const dateStr = toDateStr(viewMonth.getFullYear(), viewMonth.getMonth(), day);
                    const daySessions = sessionsByDay[day] ?? [];
                    const dayPersonal = personalEventsByDay[day] ?? [];
                    const hasSessions = daySessions.length > 0;
                    const hasPersonal = dayPersonal.length > 0;
                    const isSelected = dateStr === selectedDateStr;
                    const isTodayCell = dateStr === TODAY;

                    return (
                      <button
                        key={idx}
                        onClick={() => setSelectedDateStr(dateStr)}
                        style={{
                          aspectRatio: "1",
                          border: isSelected ? "2px solid #2D6A5C" : isTodayCell ? "1px solid #2D6A5C" : "1px solid #E5DFD5",
                          background: isSelected ? "#2D6A5C" : isTodayCell ? "#E8F2EF" : "#FFFFFF",
                          borderRadius: 8,
                          cursor: "pointer",
                          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                          padding: 2,
                          transition: "all 0.15s",
                        }}
                      >
                        <span style={{
                          fontSize: 12, fontWeight: isSelected || isTodayCell ? 700 : 500,
                          color: isSelected ? "#FFFFFF" : isTodayCell ? "#2D6A5C" : "#1C1C1E",
                        }}>
                          {day}
                        </span>
                        {(hasSessions || hasPersonal) && (
                          <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                            {hasSessions && (
                              <div style={{
                                width: 4, height: 4, borderRadius: "50%",
                                background: isSelected ? "#FFFFFF" : "#2D6A5C",
                              }} />
                            )}
                            {hasPersonal && (
                              <div style={{
                                width: 4, height: 4, borderRadius: "50%",
                                background: isSelected ? "#FFFFFF" : "#F59E0B",
                              }} />
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Сессии выбранного дня */}
              <div style={{ flex: 1, borderLeft: "1px solid #E5DFD5", paddingLeft: 24, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <CalendarDays size={15} style={{ color: "#2D6A5C" }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", textTransform: "capitalize" }}>
                    {isToday ? "Сегодня" : dayLabel}
                  </span>
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={selectedDateStr}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.15 }}
                    style={{ maxHeight: 340, overflowY: "auto", paddingRight: 4 }}
                  >
                    {sessionsOnDate.length === 0 && personalEventsOnDate.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "24px 0", color: "#8C7355", fontSize: 13 }}>
                        Событий нет
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[
                          ...sessionsOnDate.map(s => ({ kind: "session" as const, time: s.time, session: s })),
                          ...personalEventsOnDate.map(e => ({ kind: "personal" as const, time: e.time, event: e })),
                        ]
                          .sort((a, b) => a.time.localeCompare(b.time))
                          .map((item, i) => {
                            if (item.kind === "session") {
                              const session = item.session;
                              const idx = clientIndex(session.clientId);
                              const client = clients[idx];
                              return (
                                <div
                                  key={session.id}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 14,
                                    padding: "10px 12px", background: "#F5F3EF", borderRadius: 10,
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 56 }}>
                                    <Clock size={13} style={{ color: "#2D6A5C" }} />
                                    <span style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E" }}>{session.time}</span>
                                  </div>
                                  <Link href={`/clients/${session.clientId}`} style={{ textDecoration: "none", flex: 1 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                                      <div style={{
                                        width: 32, height: 32, background: avatarColors[idx % avatarColors.length],
                                        borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                                        fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0,
                                      }}>
                                        {client?.initials ?? "?"}
                                      </div>
                                      <div>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>{session.clientName}</div>
                                        {client && <div style={{ fontSize: 11, color: "#8C7355" }}>{client.request}</div>}
                                      </div>
                                    </div>
                                  </Link>
                                  {isToday && (
                                    <Link href={`/session/${session.clientId}`} style={{ textDecoration: "none" }}>
                                      <Button size="sm">
                                        Начать <ArrowRight size={13} style={{ marginLeft: 6 }} />
                                      </Button>
                                    </Link>
                                  )}
                                </div>
                              );
                            }
                            const evt = item.event;
                            return (
                              <div
                                key={evt.id}
                                style={{
                                  display: "flex", alignItems: "center", gap: 14,
                                  padding: "10px 12px", background: "#FFFFFF", border: "1px dashed #D8CFC0", borderRadius: 10,
                                }}
                              >
                                <input
                                  type="time"
                                  value={evt.time}
                                  onChange={e => handleUpdateEventTime(evt.id, e.target.value)}
                                  title="Изменить время"
                                  style={{
                                    minWidth: 76, fontSize: 12, fontWeight: 700, color: "#8C7355",
                                    border: "1px solid #E5DFD5", borderRadius: 5, padding: "2px 4px",
                                    background: "#F5F3EF", cursor: "pointer", flexShrink: 0,
                                  }}
                                />
                                <span style={{ fontSize: 13, fontWeight: 500, color: "#6B6058" }}>{evt.title}</span>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
                <Link href="/calendar" style={{ textDecoration: "none" }}>
                  <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: "#2D6A5C", textAlign: "center" }}>
                    Открыть полный календарь, чтобы добавить своё событие →
                  </div>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Прогресс-бары */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: "#1C1C1E" }}>
          Статистика
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {/* Средняя работа с клиентом */}
          <Card>
            <CardContent className="pt-6">
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 8 }}>
                Средняя работа с клиентом
              </h3>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: "#1C1C1E" }}>
                  {avgSessionsPerClient}
                </span>
                <span style={{ fontSize: 13, color: "#6B6058" }}>сессий в среднем</span>
              </div>
              <p style={{ fontSize: 12, color: "#8C7355", margin: 0 }}>
                Показывает удержание — сколько в среднем клиент остаётся в работе
              </p>
            </CardContent>
          </Card>

          {/* ДЗ выполнено */}
          <Card>
            <CardContent className="pt-6">
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 8 }}>
                Выполнение ДЗ
              </h3>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                  <span style={{ color: "#6B6058" }}>9 / 16 заданий</span>
                  <span style={{ color: "#1BAF7A", fontWeight: 600 }}>56%</span>
                </div>
                <div style={{
                  height: 8,
                  background: "rgba(27, 175, 122, 0.1)",
                  borderRadius: 4,
                  overflow: "hidden",
                }}>
                  <div style={{
                    width: "56%",
                    height: "100%",
                    background: "linear-gradient(90deg, #1BAF7A 0%, #1a9b6d 100%)",
                    borderRadius: 4,
                  }} />
                </div>
              </div>
              <p style={{ fontSize: 12, color: "#8C7355" }}>
                9 клиентов завершили, 7 в работе
              </p>
            </CardContent>
          </Card>

          {/* Активные клиенты */}
          <Card>
            <CardContent className="pt-6">
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 8 }}>
                Статус клиентов
              </h3>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#1BAF7A" }}>3</div>
                    <div style={{ fontSize: 11, color: "#8C7355" }}>Активных</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#F59E0B" }}>1</div>
                    <div style={{ fontSize: 11, color: "#8C7355" }}>На паузе</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#8C7355" }}>0</div>
                    <div style={{ fontSize: 11, color: "#8C7355" }}>Завершено</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Список клиентов */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1C1C1E" }}>Клиенты</h2>
          <Link href="/clients" style={{ fontSize: 13, color: "#2D6A5C", textDecoration: "none", fontWeight: 600 }}>
            Все клиенты →
          </Link>
        </div>

        <div className="bg-white border border-[#E5DFD5] rounded-lg overflow-hidden shadow-sm">
          {/* Заголовок таблицы */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 0.7fr 0.7fr 0.7fr",
            padding: "16px 24px",
            borderBottom: "1px solid #E5DFD5",
            fontSize: 11,
            fontWeight: 700,
            color: "#8C7355",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            background: "#F5F3EF",
          }}>
            <span>Клиент</span>
            <span>Последний тест</span>
            <span>Динамика</span>
            <span>Сессий</span>
            <span>ДЗ</span>
            <span></span>
          </div>

          {clients.map((client, i) => {
            const lastTest = client.lastTest ?? EMPTY_LAST_TEST;
            const scorePct = lastTest.maxScore > 0 ? Math.round((lastTest.score / lastTest.maxScore) * 100) : 0;
            const hwTotal = client.hwTotal ?? 0;
            const hwCompleted = client.hwCompleted ?? 0;
            const hwPct = hwTotal > 0 ? Math.round((hwCompleted / hwTotal) * 100) : 0;
            const sessionCount = sessionCountByClient.get(client.id) ?? 0;
            return (
              <motion.div
                key={client.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35 + i * 0.05 }}
                onMouseEnter={() => setHoveredClient(client.id)}
                onMouseLeave={() => setHoveredClient(null)}
                whileHover={{ backgroundColor: "rgba(79, 126, 255, 0.08)" }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr 0.7fr 0.7fr 0.7fr",
                  padding: "16px 24px",
                  borderBottom: i < clients.length - 1 ? "1px solid #E5DFD5" : "none",
                  alignItems: "center",
                  transition: "background-color 0.2s ease",
                  cursor: "pointer",
                }}
              >
                {/* Клиент */}
                <Link href={`/clients/${client.id}`} style={{ textDecoration: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <div style={{
                      width: 36, height: 36,
                      background: avatarColors[i % avatarColors.length],
                      borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 600, color: "#fff", flexShrink: 0,
                    }}>{client.initials}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "#1C1C1E", transition: "color 0.2s" }} onMouseEnter={(e) => e.currentTarget.style.color = "#2D6A5C"} onMouseLeave={(e) => e.currentTarget.style.color = "#1C1C1E"}>{client.name}</div>
                      <div style={{ fontSize: 12, color: "#8C7355" }}>{client.request}</div>
                    </div>
                  </div>
                </Link>

                {/* Тест */}
                <div>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "3px 8px",
                    background: getScoreBg(lastTest.score, lastTest.maxScore),
                    borderRadius: 6,
                    fontSize: 13, fontWeight: 600,
                    color: getScoreColor(lastTest.score, lastTest.maxScore),
                  }}>
                    {client.lastTest ? `${lastTest.name}: ${lastTest.score}` : "Нет данных"}
                  </span>
                  <div style={{ fontSize: 11, color: "#8C7355", marginTop: 3 }}>
                    {lastTest.date}
                  </div>
                </div>

                {/* Прогресс-бар */}
                <div>
                  <div style={{ height: 6, background: "rgba(79, 126, 255, 0.1)", borderRadius: 4, overflow: "hidden", width: 100 }}>
                    <div style={{
                      width: `${scorePct}%`, height: "100%",
                      background: getScoreColor(lastTest.score, lastTest.maxScore),
                      borderRadius: 4,
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: "#8C7355", marginTop: 3 }}>
                    {scorePct}% шкалы
                  </div>
                </div>

                {/* Сессии */}
                <span style={{ fontSize: 14, fontWeight: 500, color: "#1C1C1E" }}>{sessionCount}</span>

                {/* ДЗ */}
                <span style={{
                  fontSize: 13, fontWeight: 500,
                  color: hwPct >= 60 ? "#1BAF7A" : "#8C7355",
                }}>
                  {hwCompleted}/{hwTotal}
                </span>

                {/* Действие */}
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Link href={`/clients/${client.id}`} style={{ textDecoration: "none" }}>
                    <Button variant="secondary" size="sm">
                      Открыть
                    </Button>
                  </Link>
                </motion.div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

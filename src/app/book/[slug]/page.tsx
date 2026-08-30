"use client";
import { useState, useEffect, use, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Clock, Check, ChevronLeft, ChevronRight } from "lucide-react";

interface Slot {
  date: string;
  time: string;
  durationMinutes: number;
}

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_LABELS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}

function weekdayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const jsDay = d.getDay(); // 0=вс
  const idx = jsDay === 0 ? 6 : jsDay - 1;
  return WEEKDAY_LABELS[idx];
}

export default function PublicBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [psychologist, setPsychologist] = useState<{ name: string; specialty: string | null } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ scheduledAt: string; message: string } | null>(null);

  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/public/booking/${slug}/slots`);
        const data = await res.json();
        if (!cancelled) {
          if (res.ok) {
            setSlots(data.slots ?? []);
            setPsychologist(data.psychologist ?? null);
          } else {
            setError(data.error ?? "Страница бронирования не найдена");
          }
        }
      } catch {
        if (!cancelled) setError("Не удалось загрузить доступное время");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const datesWithSlots = useMemo(() => {
    const dates = Array.from(new Set(slots.map(s => s.date))).sort();
    return dates;
  }, [slots]);

  const visibleDates = useMemo(() => {
    const start = weekOffset * 7;
    return datesWithSlots.slice(start, start + 7);
  }, [datesWithSlots, weekOffset]);

  useEffect(() => {
    if (!selectedDate && visibleDates.length > 0) {
      setSelectedDate(visibleDates[0]);
    }
  }, [visibleDates, selectedDate]);

  const slotsForSelectedDate = useMemo(
    () => slots.filter(s => s.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time)),
    [slots, selectedDate]
  );

  async function submit() {
    if (!selectedDate || !selectedTime || submitting) return;
    if (!name.trim()) {
      setSubmitError("Укажите имя");
      return;
    }
    if (!telegram.trim()) {
      setSubmitError("Укажите Telegram");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/public/booking/${slug}/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedDate,
          time: selectedTime,
          client_name: name.trim(),
          client_telegram: telegram.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfirmed({ scheduledAt: data.scheduled_at, message: data.payment_instructions });
      } else {
        setSubmitError(data.error ?? "Не удалось создать бронь");
      }
    } catch {
      setSubmitError("Не удалось связаться с сервером");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #FBF9F5 0%, #F5F3EF 100%)",
        fontFamily: "var(--font-sans)",
        display: "flex",
        justifyContent: "center",
        padding: "32px 16px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 480 }}>
        {/* Шапка */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 14px", color: "#fff", fontSize: 22, fontWeight: 800,
          }}>
            Т
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>
            {psychologist ? `Запись к ${psychologist.name}` : "Запись на консультацию"}
          </h1>
          <p style={{ fontSize: 13, color: "#8C7355", marginTop: 6 }}>
            {psychologist?.specialty ? `${psychologist.specialty} · ` : ""}
            Выберите удобное время — подтверждение придёт в Telegram
          </p>
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#8C7355", fontSize: 13 }}>
            Загружаю доступное время...
          </div>
        )}

        {!loading && error && (
          <div style={{
            textAlign: "center", padding: "32px 20px", background: "#fff",
            borderRadius: 16, border: "1px solid #E5DFD5", color: "#8C7355", fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {!loading && !error && confirmed && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              background: "#fff", borderRadius: 16, border: "1px solid #E5DFD5",
              padding: 28, textAlign: "center",
            }}
          >
            <div style={{
              width: 48, height: 48, borderRadius: "50%", background: "#E6F7F2",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <Check size={24} style={{ color: "#1BAF7A" }} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "#1C1C1E", marginBottom: 8 }}>
              Бронь создана
            </h2>
            <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.6, marginBottom: 4 }}>
              {new Date(confirmed.scheduledAt).toLocaleDateString("ru", { day: "numeric", month: "long" })}
              {" в "}
              {new Date(confirmed.scheduledAt).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.6, marginTop: 12 }}>
              {confirmed.message}
            </p>
          </motion.div>
        )}

        {!loading && !error && !confirmed && (
          <>
            {datesWithSlots.length === 0 ? (
              <div style={{
                textAlign: "center", padding: "32px 20px", background: "#fff",
                borderRadius: 16, border: "1px solid #E5DFD5", color: "#8C7355", fontSize: 13,
              }}>
                Свободного времени сейчас нет — попробуйте зайти позже
              </div>
            ) : (
              <>
                {/* Выбор даты */}
                <div style={{
                  background: "#fff", borderRadius: 16, border: "1px solid #E5DFD5",
                  padding: 16, marginBottom: 12,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#1C1C1E" }}>
                      <Calendar size={14} style={{ color: "#2D6A5C" }} /> Выберите дату
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        onClick={() => setWeekOffset(w => Math.max(0, w - 1))}
                        disabled={weekOffset === 0}
                        style={{
                          width: 26, height: 26, border: "1px solid #E5DFD5", borderRadius: 6,
                          background: "#fff", cursor: weekOffset === 0 ? "default" : "pointer",
                          opacity: weekOffset === 0 ? 0.4 : 1,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <button
                        onClick={() => setWeekOffset(w => (w + 1) * 7 < datesWithSlots.length ? w + 1 : w)}
                        disabled={(weekOffset + 1) * 7 >= datesWithSlots.length}
                        style={{
                          width: 26, height: 26, border: "1px solid #E5DFD5", borderRadius: 6,
                          background: "#fff",
                          cursor: (weekOffset + 1) * 7 >= datesWithSlots.length ? "default" : "pointer",
                          opacity: (weekOffset + 1) * 7 >= datesWithSlots.length ? 0.4 : 1,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                    {visibleDates.map(date => (
                      <button
                        key={date}
                        onClick={() => { setSelectedDate(date); setSelectedTime(null); }}
                        style={{
                          flex: "0 0 auto", minWidth: 56, padding: "8px 6px",
                          borderRadius: 10, cursor: "pointer", textAlign: "center",
                          border: selectedDate === date ? "1.5px solid #2D6A5C" : "1px solid #E5DFD5",
                          background: selectedDate === date ? "#E8F2EF" : "#fff",
                        }}
                      >
                        <div style={{ fontSize: 10.5, color: "#8C7355", fontWeight: 600 }}>{weekdayLabel(date)}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: selectedDate === date ? "#2D6A5C" : "#1C1C1E", marginTop: 2 }}>
                          {formatDateLabel(date)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Выбор времени */}
                {selectedDate && (
                  <div style={{
                    background: "#fff", borderRadius: 16, border: "1px solid #E5DFD5",
                    padding: 16, marginBottom: 12,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#1C1C1E", marginBottom: 12 }}>
                      <Clock size={14} style={{ color: "#2D6A5C" }} /> Выберите время
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                      {slotsForSelectedDate.map(slot => (
                        <button
                          key={slot.time}
                          onClick={() => setSelectedTime(slot.time)}
                          style={{
                            padding: "9px 4px", borderRadius: 8, cursor: "pointer",
                            fontSize: 12.5, fontWeight: 600, textAlign: "center",
                            border: selectedTime === slot.time ? "1.5px solid #2D6A5C" : "1px solid #E5DFD5",
                            background: selectedTime === slot.time ? "#2D6A5C" : "#fff",
                            color: selectedTime === slot.time ? "#fff" : "#1C1C1E",
                          }}
                        >
                          {slot.time}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Форма контакта */}
                <AnimatePresence>
                  {selectedDate && selectedTime && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      style={{ overflow: "hidden" }}
                    >
                      <div style={{
                        background: "#fff", borderRadius: 16, border: "1px solid #E5DFD5",
                        padding: 16,
                      }}>
                        {submitError && (
                          <p style={{ fontSize: 12.5, color: "#EF4444", marginBottom: 10 }}>{submitError}</p>
                        )}
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ fontSize: 11.5, fontWeight: 600, color: "#6B6058" }}>Ваше имя</label>
                          <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Как к вам обращаться"
                            style={inputStyle}
                          />
                        </div>
                        <div style={{ marginBottom: 14 }}>
                          <label style={{ fontSize: 11.5, fontWeight: 600, color: "#6B6058" }}>Telegram</label>
                          <input
                            value={telegram}
                            onChange={e => setTelegram(e.target.value)}
                            placeholder="@username"
                            style={inputStyle}
                          />
                        </div>
                        <button
                          onClick={submit}
                          disabled={submitting}
                          style={{
                            width: "100%", padding: "12px 16px", borderRadius: 10, border: "none",
                            background: "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)",
                            color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
                            fontFamily: "var(--font-sans)",
                            opacity: submitting ? 0.7 : 1,
                          }}
                        >
                          {submitting ? "Бронирую..." : "Забронировать"}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block", marginTop: 5, width: "100%",
  padding: "10px 12px", border: "1px solid #E5DFD5",
  borderRadius: 8, fontSize: 14, fontFamily: "var(--font-sans)",
  color: "#1C1C1E", boxSizing: "border-box",
};

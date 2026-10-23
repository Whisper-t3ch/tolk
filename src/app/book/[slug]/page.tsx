"use client";
import { useState, useEffect, use, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Clock, Check, ChevronLeft, ChevronRight, Send, Globe, Users, Video, MapPin, Quote } from "lucide-react";
import {
  formatDateInTimeZone, formatTimeInTimeZone, zonedDateTimeToUtc, isValidTimeZone, DEFAULT_TIMEZONE, TIMEZONE_OPTIONS,
} from "@/lib/timezone";
import {
  ACCENTS, EMPTY_PROFILE, FORMAT_LABELS, formatPrice,
  type BookingProfile, type BookingReview, type BookingService,
} from "@/lib/bookingProfile";

function timeZoneLabel(tz: string): string {
  const found = TIMEZONE_OPTIONS.find(o => o.value === tz);
  return found ? found.label : tz;
}

// Склонение имени психолога в дательный падеж для заголовка «Запись к
// Антону Имершону» — psychologist.name хранится в именительном падеже.
// Полноценный морфологический разбор избыточен — покрываем частые окончания,
// нераспознанное оставляем как есть.
function toDativeCase(fullName: string): string {
  return fullName
    .split(/\s+/)
    .map(word => {
      if (/ий$/i.test(word)) return word.replace(/ий$/i, "ию");
      if (/ей$/i.test(word)) return word.replace(/ей$/i, "ею");
      if (/[бвгджзклмнпрстфхцчшщ]а$/i.test(word)) return word.replace(/а$/i, "е");
      if (/я$/i.test(word)) return word.replace(/я$/i, "е");
      if (/[бвгджзйклмнпрстфхцчшщ]$/i.test(word)) return word + "у";
      return word;
    })
    .join(" ");
}

interface Slot {
  date: string; // дата и время в поясе психолога — именно их принимает бэкенд
  time: string;
  durationMinutes: number;
}
/** Слот с временем, пересчитанным в пояс клиента. */
interface LocalSlot extends Slot {
  localDate: string;
  localTime: string;
}

interface Info {
  name: string;
  specialty: string | null;
  timezone: string;
  profile: BookingProfile;
  services: BookingService[];
  reviews: BookingReview[];
}

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_LABELS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const MONTH_NOMINATIVE = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTH_LABELS[m - 1]}`;
}

function weekdayFull(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"][d.getUTCDay()];
}

const FORMAT_ICON = { online: Video, offline: MapPin, both: Video } as const;

export default function PublicBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const [infoLoading, setInfoLoading] = useState(true);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [rawSlots, setRawSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [psyTz, setPsyTz] = useState(DEFAULT_TIMEZONE);

  // Пояс клиента: по умолчанию — пояс его устройства; слоты пересчитываются из пояса психолога.
  const [clientTz, setClientTz] = useState<string>(DEFAULT_TIMEZONE);
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<LocalSlot | null>(null);

  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ when: string; message: string; service: string | null } | null>(null);
  const bookingRef = useRef<HTMLDivElement>(null);

  // Витрина специалиста.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/booking/${slug}/info`);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setInfo(data as Info);
          setPsyTz(data.timezone ?? DEFAULT_TIMEZONE);
          const first = (data.services as BookingService[] | undefined)?.[0];
          if (first) setServiceId(first.id);
          let browserTz: string | null = null;
          try { browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* нет Intl */ }
          setClientTz(browserTz && isValidTimeZone(browserTz) ? browserTz : data.timezone ?? DEFAULT_TIMEZONE);
        } else {
          setError(data.error ?? "Страница бронирования не найдена");
        }
      } catch {
        if (!cancelled) setError("Не удалось загрузить страницу");
      } finally {
        if (!cancelled) setInfoLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Слоты — заново при смене услуги (у неё своя длительность).
  useEffect(() => {
    if (!info) return;
    let cancelled = false;
    (async () => {
      setSlotsLoading(true);
      try {
        const qs = serviceId ? `?service=${encodeURIComponent(serviceId)}` : "";
        const res = await fetch(`/api/public/booking/${slug}/slots${qs}`);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setRawSlots(data.slots ?? []);
          setTelegramConnected(Boolean(data.telegram_connected));
          setPsyTz(data.timezone ?? DEFAULT_TIMEZONE);
        } else {
          setError(data.error ?? "Не удалось загрузить доступное время");
        }
      } catch {
        if (!cancelled) setError("Не удалось загрузить доступное время");
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    })();
    setSelectedSlot(null);
    return () => { cancelled = true; };
  }, [slug, serviceId, info]);

  const slots: LocalSlot[] = useMemo(() => {
    return rawSlots
      .map(s => {
        const utc = zonedDateTimeToUtc(s.date, s.time, psyTz);
        return { ...s, localDate: formatDateInTimeZone(utc, clientTz), localTime: formatTimeInTimeZone(utc, clientTz) };
      })
      .sort((a, b) => (a.localDate + a.localTime).localeCompare(b.localDate + b.localTime));
  }, [rawSlots, psyTz, clientTz]);

  const datesWithSlots = useMemo(() => Array.from(new Set(slots.map(s => s.localDate))).sort(), [slots]);

  // При смене набора слотов/пояса — выбрать ближайшую дату и её месяц.
  useEffect(() => {
    if (datesWithSlots.length === 0) {
      setSelectedDate(null);
      return;
    }
    if (!selectedDate || !datesWithSlots.includes(selectedDate)) {
      const first = datesWithSlots[0];
      setSelectedDate(first);
      const [y, m] = first.split("-").map(Number);
      setMonth({ y, m: m - 1 });
    } else if (!month) {
      const [y, m] = selectedDate.split("-").map(Number);
      setMonth({ y, m: m - 1 });
    }
  }, [datesWithSlots, selectedDate, month]);

  const slotsForDate = useMemo(() => slots.filter(s => s.localDate === selectedDate), [slots, selectedDate]);

  const monthBounds = useMemo(() => {
    if (datesWithSlots.length === 0) return null;
    const f = datesWithSlots[0].split("-").map(Number);
    const l = datesWithSlots[datesWithSlots.length - 1].split("-").map(Number);
    return { min: f[0] * 12 + f[1] - 1, max: l[0] * 12 + l[1] - 1 };
  }, [datesWithSlots]);

  const tzOptions = useMemo(() => {
    const list = [...TIMEZONE_OPTIONS];
    if (!list.some(o => o.value === clientTz)) list.unshift({ value: clientTz, label: `Ваше устройство (${clientTz})` });
    return list;
  }, [clientTz]);

  const accent = ACCENTS[info?.profile.accent ?? EMPTY_PROFILE.accent] ?? ACCENTS.green;
  const service = info?.services.find(s => s.id === serviceId) ?? null;

  async function submit() {
    if (!selectedSlot || submitting) return;
    if (!name.trim()) { setSubmitError("Укажите имя"); return; }
    if (!contact.trim()) { setSubmitError("Укажите контакт для связи: Telegram или номер телефона"); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/public/booking/${slug}/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedSlot.date,
          time: selectedSlot.time,
          client_name: name.trim(),
          client_contact: contact.trim(),
          service_id: serviceId ?? undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const utc = new Date(data.scheduled_at);
        setConfirmed({
          when: `${formatDateLabel(formatDateInTimeZone(utc, clientTz))} в ${formatTimeInTimeZone(utc, clientTz)} (${timeZoneLabel(clientTz)})`,
          message: data.payment_instructions,
          service: service?.title ?? null,
        });
        setTimeout(() => bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      } else {
        setSubmitError(data.error ?? "Не удалось создать бронь");
      }
    } catch {
      setSubmitError("Не удалось связаться с сервером");
    } finally {
      setSubmitting(false);
    }
  }

  const profile = info?.profile ?? EMPTY_PROFILE;
  const initial = (info?.name ?? "Т").trim().charAt(0).toUpperCase();

  // Сетка месяца (понедельник — первый день).
  const grid = useMemo(() => {
    if (!month) return [];
    const first = new Date(Date.UTC(month.y, month.m, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
    const cells: Array<string | null> = Array(offset).fill(null);
    for (let d = 1; d <= days; d++) cells.push(`${month.y}-${pad(month.m + 1)}-${pad(d)}`);
    return cells;
  }, [month]);

  const card: React.CSSProperties = { background: "#fff", borderRadius: 16, border: "1px solid #E5DFD5", padding: 20, marginBottom: 14 };
  const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: "#1C1C1E", margin: "0 0 12px" };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #FBF9F5 0%, #F5F3EF 100%)", fontFamily: "var(--font-sans)", display: "flex", justifyContent: "center", padding: "28px 16px 56px" }}>
      <style>{`
        .bk-two{display:grid;grid-template-columns:1fr 1fr;gap:18px}
        .bk-svc{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
        @media (max-width:720px){.bk-two{grid-template-columns:1fr}}
        .bk-day:focus-visible,.bk-btn:focus-visible{outline:2px solid ${accent.color};outline-offset:2px}
      `}</style>
      <div style={{ width: "100%", maxWidth: 820 }}>
        {infoLoading && <div style={{ textAlign: "center", padding: "48px 0", color: "#6F5A3F", fontSize: 13 }}>Загружаю страницу...</div>}

        {!infoLoading && error && !info && (
          <div style={{ ...card, textAlign: "center", color: "#6F5A3F", fontSize: 13 }}>{error}</div>
        )}

        {info && (
          <>
            {/* Шапка специалиста */}
            <div style={{ ...card, padding: 24 }}>
              <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{
                  width: 112, height: 112, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
                  background: accent.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 44, fontWeight: 800,
                }}>
                  {profile.photo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={profile.photo} alt={info.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : initial}
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1C1C1E", margin: 0 }}>{info.name}</h1>
                  {(profile.headline || info.specialty) && (
                    <p style={{ fontSize: 14, color: "#6B6058", margin: "4px 0 0" }}>{profile.headline || info.specialty}</p>
                  )}
                  {profile.tags.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      {profile.tags.map(t => (
                        <span key={t} style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: accent.soft, color: accent.color }}>{t}</span>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                    {profile.links.telegram && <SocialLink href={profile.links.telegram} icon={<Send size={13} />} text="Telegram" color={accent.color} />}
                    {profile.links.vk && <SocialLink href={profile.links.vk} icon={<Users size={13} />} text="ВКонтакте" color={accent.color} />}
                    {profile.links.website && <SocialLink href={profile.links.website} icon={<Globe size={13} />} text="Сайт" color={accent.color} />}
                  </div>
                </div>
              </div>
              <button
                className="bk-btn"
                onClick={() => bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                style={{ marginTop: 18, width: "100%", padding: "12px 16px", borderRadius: 10, border: "none", background: accent.color, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)" }}
              >
                Записаться на консультацию
              </button>
            </div>

            {profile.about && (
              <div style={card}>
                <h2 style={sectionTitle}>О специалисте</h2>
                <p style={{ fontSize: 14, color: "#3A3530", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap" }}>{profile.about}</p>
              </div>
            )}

            {profile.qualifications.length > 0 && (
              <div style={{ ...card, background: accent.soft, borderColor: "transparent" }}>
                <h2 style={{ ...sectionTitle, color: accent.color }}>Квалификация</h2>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                  {profile.qualifications.map(q => (
                    <li key={q} style={{ display: "flex", gap: 8, fontSize: 13.5, color: "#1C1C1E", lineHeight: 1.5 }}>
                      <Check size={15} style={{ color: accent.color, flexShrink: 0, marginTop: 2 }} /> {q}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {info.services.length > 0 && (
              <div style={card}>
                <h2 style={sectionTitle}>Услуги</h2>
                <div className="bk-svc">
                  {info.services.map(s => {
                    const active = s.id === serviceId;
                    const Icon = FORMAT_ICON[s.format];
                    return (
                      <div key={s.id} style={{ border: active ? `2px solid ${accent.color}` : "1px solid #E5DFD5", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8, background: active ? accent.soft : "#fff" }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: "#1C1C1E" }}>{s.title}</div>
                        {s.description && <div style={{ fontSize: 12.5, color: "#6B6058", lineHeight: 1.5 }}>{s.description}</div>}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "#6F5A3F", marginTop: "auto" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon size={12} /> {FORMAT_LABELS[s.format]}</span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={12} /> {s.duration_minutes} мин</span>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: accent.color }}>{formatPrice(s.price)}</div>
                        <button
                          className="bk-btn"
                          onClick={() => {
                            setServiceId(s.id);
                            setConfirmed(null);
                            bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                          style={{ padding: "9px 12px", borderRadius: 8, border: active ? "none" : `1px solid ${accent.color}`, background: active ? accent.color : "#fff", color: active ? "#fff" : accent.color, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)" }}
                        >
                          {active ? "Выбрано" : "Выбрать"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {info.reviews.length > 0 && (
              <div style={card}>
                <h2 style={sectionTitle}>Отзывы</h2>
                <div className="bk-svc">
                  {info.reviews.map(r => (
                    <figure key={r.id} style={{ margin: 0, border: "1px solid #E5DFD5", borderRadius: 12, padding: 14, background: "#FBF9F5" }}>
                      <Quote size={16} style={{ color: accent.color, marginBottom: 6 }} />
                      <blockquote style={{ margin: 0, fontSize: 13.5, color: "#3A3530", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{r.text}</blockquote>
                      <figcaption style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "#6F5A3F" }}>{r.author}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            {/* Запись */}
            <div ref={bookingRef} style={{ ...card, scrollMarginTop: 16 }}>
              <h2 style={{ ...sectionTitle, fontSize: 17 }}>Запись к {toDativeCase(info.name)}</h2>

              {confirmed ? (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: "center", padding: "12px 0" }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: accent.soft, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                    <Check size={24} style={{ color: accent.color }} />
                  </div>
                  <h3 style={{ fontSize: 17, fontWeight: 700, color: "#1C1C1E", margin: "0 0 8px" }}>Бронь создана</h3>
                  {confirmed.service && <p style={{ fontSize: 13.5, fontWeight: 600, color: "#1C1C1E", margin: "0 0 4px" }}>{confirmed.service}</p>}
                  <p style={{ fontSize: 13.5, color: "#6B6058", lineHeight: 1.6, margin: "0 0 4px" }}>{confirmed.when}</p>
                  <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.6, margin: "12px 0 0" }}>{confirmed.message}</p>
                </motion.div>
              ) : slotsLoading && rawSlots.length === 0 ? (
                <div style={{ textAlign: "center", padding: "28px 0", color: "#6F5A3F", fontSize: 13 }}>Загружаю доступное время...</div>
              ) : datesWithSlots.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 12px", color: "#6F5A3F", fontSize: 13 }}>Свободного времени сейчас нет — попробуйте зайти позже</div>
              ) : (
                <>
                  {service && (
                    <p style={{ fontSize: 13, color: "#6B6058", margin: "0 0 12px" }}>
                      <b style={{ color: "#1C1C1E" }}>{service.title}</b> · {service.duration_minutes} мин · {formatPrice(service.price)}
                    </p>
                  )}
                  <div style={{ marginBottom: 14 }}>
                    <label htmlFor="bk-tz" style={{ fontSize: 12, fontWeight: 600, color: "#6B6058" }}>Ваш часовой пояс</label>
                    <select
                      id="bk-tz"
                      value={clientTz}
                      onChange={e => { setClientTz(e.target.value); setSelectedSlot(null); setSelectedDate(null); setMonth(null); }}
                      style={{ display: "block", marginTop: 5, width: "100%", maxWidth: 380, padding: "9px 10px", border: "1px solid #E5DFD5", borderRadius: 8, fontSize: 13, background: "#fff", color: "#1C1C1E", fontFamily: "var(--font-sans)" }}
                    >
                      {tzOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  <div className="bk-two">
                    {/* Календарь месяца */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#1C1C1E" }}>
                          <Calendar size={14} style={{ color: accent.color }} />
                          {month ? `${MONTH_NOMINATIVE[month.m]} ${month.y}` : "Выберите дату"}
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          {([-1, 1] as const).map(dir => {
                            const disabled = !month || !monthBounds || (dir === -1 ? month.y * 12 + month.m <= monthBounds.min : month.y * 12 + month.m >= monthBounds.max);
                            return (
                              <button
                                key={dir}
                                className="bk-btn"
                                aria-label={dir === -1 ? "Предыдущий месяц" : "Следующий месяц"}
                                disabled={disabled}
                                onClick={() => setMonth(prev => { if (!prev) return prev; const t = prev.y * 12 + prev.m + dir; return { y: Math.floor(t / 12), m: t % 12 }; })}
                                style={{ width: 28, height: 28, border: "1px solid #E5DFD5", borderRadius: 6, background: "#fff", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}
                              >
                                {dir === -1 ? <ChevronLeft size={14} color="#1C1C1E" /> : <ChevronRight size={14} color="#1C1C1E" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, textAlign: "center" }}>
                        {WEEKDAY_LABELS.map(w => <div key={w} style={{ fontSize: 11, color: "#6F5A3F", fontWeight: 600, padding: "4px 0" }}>{w}</div>)}
                        {grid.map((d, i) => {
                          if (!d) return <div key={`e${i}`} />;
                          const has = datesWithSlots.includes(d);
                          const sel = d === selectedDate;
                          return (
                            <button
                              key={d}
                              className="bk-day"
                              disabled={!has}
                              onClick={() => { setSelectedDate(d); setSelectedSlot(null); }}
                              style={{
                                aspectRatio: "1", borderRadius: 8, fontSize: 13, fontWeight: has ? 700 : 400, cursor: has ? "pointer" : "default",
                                border: sel ? `1.5px solid ${accent.color}` : "1px solid transparent",
                                background: sel ? accent.color : has ? accent.soft : "transparent",
                                color: sel ? "#fff" : has ? accent.color : "#B8B0A4",
                              }}
                            >
                              {Number(d.slice(8))}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Время */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#1C1C1E", marginBottom: 6 }}>
                        <Clock size={14} style={{ color: accent.color }} />
                        {selectedDate ? `${formatDateLabel(selectedDate)}, ${weekdayFull(selectedDate)}` : "Выберите время"}
                      </div>
                      <p style={{ fontSize: 12, color: "#6F5A3F", margin: "0 0 10px" }}>Время указано: {timeZoneLabel(clientTz)}</p>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        {slotsForDate.map(slot => {
                          const sel = selectedSlot?.date === slot.date && selectedSlot?.time === slot.time;
                          return (
                            <button
                              key={slot.date + slot.time}
                              className="bk-btn"
                              onClick={() => setSelectedSlot(slot)}
                              style={{ padding: "10px 4px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, textAlign: "center", border: sel ? `1.5px solid ${accent.color}` : "1px solid #E5DFD5", background: sel ? accent.color : "#fff", color: sel ? "#fff" : "#1C1C1E", fontFamily: "var(--font-sans)" }}
                            >
                              {slot.localTime}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <AnimatePresence>
                    {selectedSlot && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
                        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #E5DFD5" }}>
                          {submitError && <p style={{ fontSize: 12.5, color: "#B91C1C", marginBottom: 10 }}>{submitError}</p>}
                          <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 11.5, fontWeight: 600, color: "#6B6058" }}>Ваше имя</label>
                            <input value={name} onChange={e => setName(e.target.value)} placeholder="Как к вам обращаться" style={inputStyle} />
                          </div>
                          <div style={{ marginBottom: 14 }}>
                            <label style={{ fontSize: 11.5, fontWeight: 600, color: "#6B6058" }}>Контакт для связи</label>
                            <input value={contact} onChange={e => setContact(e.target.value)} placeholder="@username в Telegram или номер телефона" style={inputStyle} />
                          </div>
                          <button
                            className="bk-btn"
                            onClick={submit}
                            disabled={submitting}
                            style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "none", background: accent.color, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)", opacity: submitting ? 0.7 : 1 }}
                          >
                            {submitting ? "Бронирую..." : `Забронировать на ${formatDateLabel(selectedSlot.localDate)} в ${selectedSlot.localTime}`}
                          </button>
                          <p style={{ fontSize: 12, color: "#6F5A3F", margin: "10px 0 0", textAlign: "center" }}>
                            {telegramConnected ? "Подтверждение и детали оплаты придут от психолога в Telegram." : "Психолог свяжется с вами по указанному контакту для подтверждения."}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SocialLink({ href, icon, text, color }: { href: string; icon: React.ReactNode; text: string; color: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: `1px solid ${color}`, color, textDecoration: "none", background: "#fff" }}
    >
      {icon} {text}
    </a>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block", marginTop: 5, width: "100%", padding: "10px 12px", border: "1px solid #E5DFD5",
  borderRadius: 8, fontSize: 14, fontFamily: "var(--font-sans)", color: "#1C1C1E", boxSizing: "border-box",
};

"use client";
import { useState, useEffect, use, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { Clock, Check, ChevronLeft, ChevronRight, ChevronDown, ArrowLeft, ArrowRight, Send, Globe, Users, Video, MapPin, CreditCard, Quote } from "lucide-react";
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

  // profile — витрина специалиста; booking — выбор времени и контакты (как отдельная страница услуги).
  const [view, setView] = useState<"profile" | "booking">("profile");
  const [step, setStep] = useState<1 | 2>(1);
  const [openFaq, setOpenFaq] = useState<string | null>(null);

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
  const servicesRef = useRef<HTMLDivElement>(null);

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

  // Слоты — при входе в запись и при смене услуги (у неё своя длительность).
  useEffect(() => {
    if (!info || view !== "booking") return;
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
  }, [slug, serviceId, info, view]);

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

  function startBooking(id: string | null) {
    if (id) setServiceId(id);
    setConfirmed(null);
    setStep(1);
    setSubmitError(null);
    setView("booking");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function leaveBooking() {
    setView("profile");
    setConfirmed(null);
    setStep(1);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function chooseService() {
    if (!info || info.services.length === 0) startBooking(null);
    else servicesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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

  const card: React.CSSProperties = { background: "#fff", borderRadius: 20, boxShadow: "0 2px 14px rgba(40,30,10,0.06)", padding: "28px 32px" };
  const h2: React.CSSProperties = { fontSize: 24, fontWeight: 800, color: "#1C1C1E", margin: "0 0 16px" };
  const gradBtn: React.CSSProperties = {
    border: "none", background: `linear-gradient(135deg, ${accent.color} 0%, ${accent.color}E6 100%)`, color: "#fff",
    fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)", borderRadius: 12,
  };
  const hasAbout = Boolean(profile.about);
  const hasQuals = profile.qualifications.length > 0;

  return (
    <div style={{ minHeight: "100vh", background: "#FCFAF6", fontFamily: "var(--font-sans)", padding: "28px 16px 48px" }}>
      <style>{`
        .bk-wrap{width:100%;max-width:1040px;margin:0 auto}
        .bk-about{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}
        .bk-grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px}
        .bk-pane{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)}
        .bk-h1{font-size:36px}
        @media (max-width:760px){.bk-about{grid-template-columns:1fr}.bk-pane{grid-template-columns:1fr}.bk-h1{font-size:26px}.bk-pad{padding:20px 16px!important}}
        .bk-day:focus-visible,.bk-btn:focus-visible,.bk-faq:focus-visible{outline:2px solid ${accent.color};outline-offset:2px}
        .bk-btn:hover:not(:disabled){filter:brightness(1.05)}
      `}</style>
      <div className="bk-wrap">
        {infoLoading && <div style={{ textAlign: "center", padding: "48px 0", color: "#6F5A3F", fontSize: 13 }}>Загружаю страницу...</div>}

        {!infoLoading && error && !info && (
          <div style={{ ...card, textAlign: "center", color: "#6F5A3F", fontSize: 13 }}>{error}</div>
        )}

        {info && view === "profile" && (
          <div style={{ display: "grid", gap: 22 }}>
            {/* Шапка специалиста */}
            <div className="bk-pad" style={{ borderRadius: 24, padding: "36px 24px 32px", textAlign: "center", background: `linear-gradient(135deg, ${accent.soft} 0%, #FFFFFF 75%)`, boxShadow: "0 2px 14px rgba(40,30,10,0.05)" }}>
              <div style={{
                width: 160, height: 160, borderRadius: "50%", overflow: "hidden", margin: "0 auto 18px",
                border: "4px solid #fff", boxShadow: `0 6px 22px ${accent.color}33`,
                background: accent.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 60, fontWeight: 800,
              }}>
                {profile.photo
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={profile.photo} alt={info.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : initial}
              </div>
              <h1 className="bk-h1" style={{ fontWeight: 800, color: "#1C1C1E", margin: 0, lineHeight: 1.15 }}>{info.name}</h1>
              {(profile.headline || info.specialty) && (
                <p style={{ fontSize: 16, color: "#4B443C", margin: "8px auto 0", maxWidth: 720, lineHeight: 1.5 }}>{profile.headline || info.specialty}</p>
              )}
              {profile.tags.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: 16 }}>
                  {profile.tags.map(t => (
                    <span key={t} style={{ fontSize: 14, fontWeight: 700, padding: "8px 18px", borderRadius: 999, background: "#fff", color: accent.color, boxShadow: "0 1px 6px rgba(40,30,10,0.08)" }}>{t}</span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 18 }}>
                {profile.links.telegram && <SocialLink href={profile.links.telegram} label="Telegram" color={accent.color}><Send size={18} /></SocialLink>}
                {profile.links.vk && <SocialLink href={profile.links.vk} label="ВКонтакте" color={accent.color}><Users size={18} /></SocialLink>}
                {profile.links.website && <SocialLink href={profile.links.website} label="Сайт" color={accent.color}><Globe size={18} /></SocialLink>}
              </div>
            </div>

            {(hasAbout || hasQuals) && (
              <div className={hasAbout && hasQuals ? "bk-about" : undefined}>
                {hasAbout && (
                  <div className="bk-pad" style={card}>
                    <h2 style={h2}>О специалисте</h2>
                    <p style={{ fontSize: 15, color: "#3A3530", lineHeight: 1.75, margin: 0, whiteSpace: "pre-wrap" }}>{profile.about}</p>
                  </div>
                )}
                {hasQuals && (
                  <div className="bk-pad" style={{ ...card, background: `linear-gradient(160deg, ${accent.color} 0%, ${accent.color}E0 100%)`, color: "#fff", boxShadow: `0 8px 24px ${accent.color}33` }}>
                    <h2 style={{ ...h2, color: "#fff", textAlign: "center" }}>Квалификация</h2>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 14 }}>
                      {profile.qualifications.map(q => (
                        <li key={q} style={{ display: "flex", gap: 12, fontSize: 14.5, lineHeight: 1.5, alignItems: "flex-start" }}>
                          <span style={{ width: 22, height: 22, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.9)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                            <Check size={13} />
                          </span>
                          {q}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {profile.audience.trim() && (
              <div style={{ textAlign: "center", padding: "8px 8px 0" }}>
                <h2 style={{ ...h2, fontSize: 28, margin: "0 0 18px" }}>
                  {profile.audience_title.trim() || "Я смогу быть вам полезен, если вы:"}
                </h2>
                <p style={{ fontSize: 16, color: "#3A3530", lineHeight: 1.8, margin: "0 auto", maxWidth: 640, whiteSpace: "pre-wrap" }}>
                  {profile.audience}
                </p>
              </div>
            )}

            <button className="bk-btn" onClick={chooseService} style={{ ...gradBtn, width: "100%", padding: "16px 20px", fontSize: 17, boxShadow: `0 6px 18px ${accent.color}40` }}>
              Выбрать услугу и записаться
            </button>

            {profile.faq.length > 0 && (
              <div style={{ display: "grid", gap: 10 }}>
                <h2 style={{ ...h2, margin: "8px 0 4px" }}>Часто задаваемые вопросы</h2>
                {profile.faq.map(f => {
                  const open = openFaq === f.id;
                  return (
                    <div key={f.id} style={{ background: "#fff", borderRadius: 16, boxShadow: "0 1px 8px rgba(40,30,10,0.05)", overflow: "hidden" }}>
                      <button
                        className="bk-faq"
                        aria-expanded={open}
                        onClick={() => setOpenFaq(open ? null : f.id)}
                        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontSize: 15.5, fontWeight: 700, color: "#1C1C1E", fontFamily: "var(--font-sans)" }}
                      >
                        {f.q}
                        <ChevronDown size={18} style={{ color: accent.color, flexShrink: 0, transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
                      </button>
                      {open && <div style={{ padding: "0 22px 20px", fontSize: 14.5, color: "#3A3530", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{f.a}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {info.services.length > 0 && (
              <div ref={servicesRef} style={{ scrollMarginTop: 16 }}>
                <h2 style={{ ...h2, margin: "8px 0 14px" }}>Доступные услуги</h2>
                <div className="bk-grid2">
                  {info.services.map(s => {
                    const Icon = FORMAT_ICON[s.format];
                    return (
                      <div key={s.id} style={{ ...card, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                        <div style={{ fontSize: 19, fontWeight: 800, color: "#1C1C1E", lineHeight: 1.25 }}>{s.title}</div>
                        <span style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, padding: "5px 12px", borderRadius: 999, background: accent.soft, color: accent.color }}>
                          <Icon size={14} /> {FORMAT_LABELS[s.format]}
                        </span>
                        {s.description && <div style={{ fontSize: 14, color: "#5B544B", lineHeight: 1.6, flex: 1 }}>{s.description}</div>}
                        <div style={{ borderTop: "1px solid #EFE9DE", paddingTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: "#6F5A3F" }}><Clock size={16} /> {s.duration_minutes} мин</span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 16, fontWeight: 800, color: "#1C1C1E" }}><CreditCard size={16} style={{ color: "#6F5A3F" }} /> {formatPrice(s.price)}</span>
                        </div>
                        <button className="bk-btn" onClick={() => startBooking(s.id)} style={{ ...gradBtn, padding: "13px 16px", fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                          Записаться <ArrowRight size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {info.reviews.length > 0 && (
              <div>
                <h2 style={{ ...h2, margin: "8px 0 14px" }}>Отзывы клиентов</h2>
                <div className="bk-grid2">
                  {info.reviews.map(r => (
                    <figure key={r.id} style={{ ...card, margin: 0, padding: 22 }}>
                      <Quote size={20} style={{ color: accent.color, marginBottom: 8 }} />
                      <blockquote style={{ margin: 0, fontSize: 14.5, color: "#3A3530", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{r.text}</blockquote>
                      <figcaption style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: "#6F5A3F" }}>{r.author}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            {(profile.links.telegram || profile.links.vk || profile.links.website) && (
              <div className="bk-pad" style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ ...h2, margin: 0, fontSize: 20 }}>Контакты для связи</h2>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {profile.links.telegram && <TextLink href={profile.links.telegram} color={accent.color}>Telegram</TextLink>}
                  {profile.links.vk && <TextLink href={profile.links.vk} color={accent.color}>ВКонтакте</TextLink>}
                  {profile.links.website && <TextLink href={profile.links.website} color={accent.color}>Сайт</TextLink>}
                </div>
              </div>
            )}

            <Footer />
          </div>
        )}

        {info && view === "booking" && (
          <div style={{ maxWidth: 860, margin: "0 auto" }}>
            <div style={{ ...card, padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "22px 28px 8px" }}>
                <button className="bk-btn" aria-label="Назад" onClick={step === 2 && !confirmed ? () => setStep(1) : leaveBooking}
                  style={{ border: "none", background: "none", cursor: "pointer", padding: 6, borderRadius: 8, display: "inline-flex", color: "#1C1C1E" }}>
                  <ArrowLeft size={20} />
                </button>
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 14, background: "#F6F3EC", borderRadius: 999, padding: "12px 18px", flexWrap: "wrap" }}>
                  <StepDot n={1} active={step === 1 && !confirmed} done={step === 2 || Boolean(confirmed)} color={accent.color} label="Выбор времени" />
                  <span style={{ width: 40, height: 1, background: "#D9D2C5" }} />
                  <StepDot n={2} active={step === 2 || Boolean(confirmed)} done={Boolean(confirmed)} color={accent.color} label="Контактные данные" />
                </div>
                {service && (
                  <p style={{ fontSize: 13.5, color: "#6B6058", margin: "14px 0 0", textAlign: "center" }}>
                    <b style={{ color: "#1C1C1E" }}>{service.title}</b> · {service.duration_minutes} мин · {formatPrice(service.price)} · {info.name}
                  </p>
                )}
              </div>

              {confirmed ? (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: "center", padding: "32px 28px 40px" }}>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: accent.soft, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                    <Check size={28} style={{ color: accent.color }} />
                  </div>
                  <h3 style={{ fontSize: 20, fontWeight: 800, color: "#1C1C1E", margin: "0 0 8px" }}>Бронь создана</h3>
                  {confirmed.service && <p style={{ fontSize: 14.5, fontWeight: 600, color: "#1C1C1E", margin: "0 0 4px" }}>{confirmed.service}</p>}
                  <p style={{ fontSize: 14.5, color: "#6B6058", lineHeight: 1.6, margin: "0 0 4px" }}>{confirmed.when}</p>
                  <p style={{ fontSize: 14, color: "#6B6058", lineHeight: 1.6, margin: "12px auto 20px", maxWidth: 520 }}>{confirmed.message}</p>
                  <button className="bk-btn" onClick={leaveBooking} style={{ ...gradBtn, padding: "12px 22px", fontSize: 14 }}>На страницу специалиста</button>
                </motion.div>
              ) : step === 1 ? (
                slotsLoading && rawSlots.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "#6F5A3F", fontSize: 13 }}>Загружаю доступное время...</div>
                ) : datesWithSlots.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 16px", color: "#6F5A3F", fontSize: 14 }}>Свободного времени сейчас нет — попробуйте зайти позже</div>
                ) : (
                  <div className="bk-pane" style={{ marginTop: 14 }}>
                    <div style={{ padding: "20px 28px 28px" }}>
                      <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1C1C1E", margin: "0 0 14px" }}>Выберите дату</h3>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <MonthArrow dir={-1} month={month} bounds={monthBounds} setMonth={setMonth} />
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E" }}>{month ? `${MONTH_NOMINATIVE[month.m]} ${month.y}` : ""}</div>
                        <MonthArrow dir={1} month={month} bounds={monthBounds} setMonth={setMonth} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, textAlign: "center" }}>
                        {WEEKDAY_LABELS.map(w => <div key={w} style={{ fontSize: 12, color: "#6F5A3F", fontWeight: 700, padding: "6px 0" }}>{w}</div>)}
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
                                aspectRatio: "1", borderRadius: "50%", fontSize: 14, fontWeight: has ? 700 : 400, cursor: has ? "pointer" : "default", border: "none",
                                background: sel ? accent.color : "transparent", color: sel ? "#fff" : has ? "#1C1C1E" : "#C9C2B6",
                              }}
                            >
                              {Number(d.slice(8))}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ marginTop: 22 }}>
                        <label htmlFor="bk-tz" style={{ fontSize: 13, fontWeight: 700, color: "#6B6058" }}>Выберите свой часовой пояс</label>
                        <select
                          id="bk-tz"
                          value={clientTz}
                          onChange={e => { setClientTz(e.target.value); setSelectedSlot(null); setSelectedDate(null); setMonth(null); }}
                          style={{ display: "block", marginTop: 6, width: "100%", padding: "12px 12px", border: "1px solid #E5DFD5", borderRadius: 12, fontSize: 14, background: "#fff", color: "#1C1C1E", fontFamily: "var(--font-sans)" }}
                        >
                          {tzOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    </div>

                    <div style={{ background: "#F8F6F1", padding: "24px 24px 28px", display: "flex", flexDirection: "column" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".06em", color: "#6F5A3F" }}>ВЫБРАННАЯ ДАТА</div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: "#1C1C1E", margin: "4px 0 14px" }}>
                        {selectedDate ? `${weekdayFull(selectedDate)[0].toUpperCase()}${weekdayFull(selectedDate).slice(1)}, ${formatDateLabel(selectedDate)}` : "—"}
                      </div>
                      {slotsForDate.length === 0 ? (
                        <div style={{ textAlign: "center", color: "#6F5A3F", fontSize: 14, padding: "28px 0" }}>На выбранную дату нет свободных слотов. Выберите другой день.</div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                          {slotsForDate.map(slot => {
                            const sel = selectedSlot?.date === slot.date && selectedSlot?.time === slot.time;
                            return (
                              <button
                                key={slot.date + slot.time}
                                className="bk-btn"
                                onClick={() => setSelectedSlot(slot)}
                                style={{ padding: "11px 4px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700, textAlign: "center", border: sel ? `2px solid ${accent.color}` : "1px solid #E5DFD5", background: sel ? accent.color : "#fff", color: sel ? "#fff" : "#1C1C1E", fontFamily: "var(--font-sans)" }}
                              >
                                {slot.localTime}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <p style={{ fontSize: 12, color: "#6F5A3F", margin: "12px 0 0" }}>Время указано: {timeZoneLabel(clientTz)}</p>
                      <div style={{ marginTop: "auto", paddingTop: 20 }}>
                        <button className="bk-btn" disabled={!selectedSlot} onClick={() => setStep(2)}
                          style={{ ...gradBtn, width: "100%", padding: "14px 16px", fontSize: 15, opacity: selectedSlot ? 1 : 0.45, cursor: selectedSlot ? "pointer" : "default" }}>
                          Далее
                        </button>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div style={{ padding: "22px 28px 30px", maxWidth: 520, margin: "0 auto" }}>
                  {selectedSlot && (
                    <div style={{ background: accent.soft, color: accent.color, borderRadius: 12, padding: "12px 14px", fontSize: 14, fontWeight: 700, marginBottom: 16, textAlign: "center" }}>
                      {formatDateLabel(selectedSlot.localDate)}, {weekdayFull(selectedSlot.localDate)}, {selectedSlot.localTime} · {timeZoneLabel(clientTz)}
                    </div>
                  )}
                  {submitError && <p style={{ fontSize: 13, color: "#B91C1C", marginBottom: 10 }}>{submitError}</p>}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12.5, fontWeight: 700, color: "#6B6058" }}>Ваше имя</label>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Как к вам обращаться" style={inputStyle} />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 12.5, fontWeight: 700, color: "#6B6058" }}>Контакт для связи</label>
                    <input value={contact} onChange={e => setContact(e.target.value)} placeholder="@username в Telegram или номер телефона" style={inputStyle} />
                  </div>
                  <button className="bk-btn" onClick={submit} disabled={submitting}
                    style={{ ...gradBtn, width: "100%", padding: "14px 16px", fontSize: 15, opacity: submitting ? 0.7 : 1 }}>
                    {submitting ? "Бронирую..." : "Забронировать"}
                  </button>
                  <p style={{ fontSize: 12, color: "#6F5A3F", margin: "12px 0 0", textAlign: "center", lineHeight: 1.5 }}>
                    {telegramConnected ? "Подтверждение и детали оплаты придут от психолога в Telegram. " : "Психолог свяжется с вами по указанному контакту для подтверждения. "}
                    Нажимая «Забронировать», вы соглашаетесь с{" "}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: accent.color }}>политикой обработки персональных данных</a>.
                  </p>
                </div>
              )}
            </div>
            <Footer />
          </div>
        )}
      </div>
    </div>
  );
}

function StepDot({ n, active, done, color, label }: { n: number; active: boolean; done: boolean; color: string; label: string }) {
  const on = active || done;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: on ? color : "#9A9285" }}>
      <span style={{ width: 22, height: 22, borderRadius: "50%", background: on ? color : "transparent", border: on ? "none" : "2px solid #C9C2B6", color: "#fff", fontSize: 12, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        {done ? <Check size={13} /> : on ? n : ""}
      </span>
      {label}
    </span>
  );
}

function MonthArrow({ dir, month, bounds, setMonth }: {
  dir: -1 | 1;
  month: { y: number; m: number } | null;
  bounds: { min: number; max: number } | null;
  setMonth: React.Dispatch<React.SetStateAction<{ y: number; m: number } | null>>;
}) {
  const disabled = !month || !bounds || (dir === -1 ? month.y * 12 + month.m <= bounds.min : month.y * 12 + month.m >= bounds.max);
  return (
    <button
      className="bk-btn"
      aria-label={dir === -1 ? "Предыдущий месяц" : "Следующий месяц"}
      disabled={disabled}
      onClick={() => setMonth(prev => { if (!prev) return prev; const t = prev.y * 12 + prev.m + dir; return { y: Math.floor(t / 12), m: t % 12 }; })}
      style={{ width: 32, height: 32, border: "none", background: "none", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.3 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      {dir === -1 ? <ChevronLeft size={18} color="#1C1C1E" /> : <ChevronRight size={18} color="#1C1C1E" />}
    </button>
  );
}

function Footer() {
  return (
    <footer style={{ textAlign: "center", fontSize: 12.5, color: "#8A7F70", lineHeight: 1.8, padding: "8px 0" }}>
      <div>
        <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>Политика обработки персональных данных</a>
        {" · "}
        <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>Пользовательское соглашение</a>
      </div>
      <div>Работает на ТОЛК</div>
    </footer>
  );
}

function SocialLink({ href, label, color, children }: { href: string; label: string; color: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      aria-label={label}
      title={label}
      style={{ width: 44, height: 44, borderRadius: "50%", background: "#fff", color, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 8px rgba(40,30,10,0.12)" }}
    >
      {children}
    </a>
  );
}

function TextLink({ href, color, children }: { href: string; color: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow"
      style={{ fontSize: 14, fontWeight: 700, padding: "9px 16px", borderRadius: 10, border: `1.5px solid ${color}`, color, textDecoration: "none", background: "#fff" }}>
      {children}
    </a>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block", marginTop: 6, width: "100%", padding: "12px 14px", border: "1px solid #E5DFD5",
  borderRadius: 12, fontSize: 15, fontFamily: "var(--font-sans)", color: "#1C1C1E", boxSizing: "border-box",
};

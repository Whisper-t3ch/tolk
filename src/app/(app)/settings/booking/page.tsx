"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Copy, Check, Link as LinkIcon } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";
import { TIMEZONE_OPTIONS, DEFAULT_TIMEZONE } from "@/lib/timezone";
import { DateSlotsEditor } from "@/components/DateSlotsEditor";
import type { DateOverrides } from "@/lib/booking";
import BookingProfileEditor from "@/components/BookingProfileEditor";
import { EMPTY_PROFILE, type BookingProfile, type BookingService, type BookingReview } from "@/lib/bookingProfile";

interface WorkingHours {
  mon: [string, string] | null;
  tue: [string, string] | null;
  wed: [string, string] | null;
  thu: [string, string] | null;
  fri: [string, string] | null;
  sat: [string, string] | null;
  sun: [string, string] | null;
}

const DEFAULT_HOURS: WorkingHours = {
  mon: ["10:00", "19:00"],
  tue: ["10:00", "19:00"],
  wed: ["10:00", "19:00"],
  thu: ["10:00", "19:00"],
  fri: ["10:00", "19:00"],
  sat: null,
  sun: null,
};

const DAY_LABELS: { key: keyof WorkingHours; label: string }[] = [
  { key: "mon", label: "Понедельник" },
  { key: "tue", label: "Вторник" },
  { key: "wed", label: "Среда" },
  { key: "thu", label: "Четверг" },
  { key: "fri", label: "Пятница" },
  { key: "sat", label: "Суббота" },
  { key: "sun", label: "Воскресенье" },
];

interface BookingSettings {
  public_slug: string;
  working_hours: WorkingHours;
  date_overrides?: DateOverrides | null;
  session_duration_minutes: number;
  buffer_minutes: number;
  min_notice_hours: number;
  max_advance_days: number;
  is_active: boolean;
  profile?: BookingProfile;
  services?: BookingService[];
  reviews?: BookingReview[];
}

export default function BookingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const [isActive, setIsActive] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [workingHours, setWorkingHours] = useState<WorkingHours>(DEFAULT_HOURS);
  const [dateOverrides, setDateOverrides] = useState<DateOverrides>({});
  const [duration, setDuration] = useState(50);
  const [buffer, setBuffer] = useState(10);
  const [minNotice, setMinNotice] = useState(2);
  const [maxAdvance, setMaxAdvance] = useState(30);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [profile, setProfile] = useState<BookingProfile>(EMPTY_PROFILE);
  const [services, setServices] = useState<BookingService[]>([]);
  const [reviews, setReviews] = useState<BookingReview[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/booking-settings");
        const data = await res.json();
        if (cancelled || !res.ok) return;
        if (data.timezone) setTimezone(data.timezone);
        if (data.settings) {
          const s: BookingSettings = data.settings;
          setSlug(s.public_slug);
          setIsActive(s.is_active);
          setWorkingHours({ ...DEFAULT_HOURS, ...s.working_hours });
          setDateOverrides(s.date_overrides ?? {});
          setDuration(s.session_duration_minutes);
          setBuffer(s.buffer_minutes);
          setMinNotice(s.min_notice_hours);
          setMaxAdvance(s.max_advance_days);
          if (s.profile) setProfile({ ...EMPTY_PROFILE, ...s.profile });
          setServices(s.services ?? []);
          setReviews(s.reviews ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Пояс, в котором сейчас физически находится психолог — если он
  // расходится с сохранённым, показываем подсказку: расхождение как раз
  // и приводит к тому, что время сессии «уезжает».
  const browserTimeZone = typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : null;

  async function save(patch: Partial<{
    working_hours: WorkingHours;
    date_overrides: DateOverrides;
    session_duration_minutes: number;
    buffer_minutes: number;
    min_notice_hours: number;
    max_advance_days: number;
    is_active: boolean;
    timezone: string;
    profile: BookingProfile;
    services: BookingService[];
    reviews: BookingReview[];
  }>): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/booking-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok && data.settings) {
        setSlug(data.settings.public_slug);
        setNotification("Сохранено");
        setTimeout(() => setNotification(null), 2000);
        return true;
      } else {
        setError(data.error ?? "Не удалось сохранить настройки");
        return false;
      }
    } catch {
      setError("Не удалось связаться с сервером");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function toggleActive() {
    const next = !isActive;
    setIsActive(next);
    save({ is_active: next });
  }

  function toggleDayOff(day: keyof WorkingHours) {
    const next = { ...workingHours, [day]: workingHours[day] ? null : (["10:00", "19:00"] as [string, string]) };
    setWorkingHours(next);
    save({ working_hours: next });
  }

  function updateDayTime(day: keyof WorkingHours, index: 0 | 1, value: string) {
    const current = workingHours[day] ?? ["10:00", "19:00"];
    const updated: [string, string] = index === 0 ? [value, current[1]] : [current[0], value];
    const next = { ...workingHours, [day]: updated };
    setWorkingHours(next);
  }

  function commitWorkingHours() {
    save({ working_hours: workingHours });
  }

  const bookingUrl = slug ? `${typeof window !== "undefined" ? window.location.origin : ""}/book/${slug}` : null;

  function copyLink() {
    if (!bookingUrl) return;
    navigator.clipboard?.writeText(bookingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px" }}>
        <p style={{ fontSize: 13, color: "#6F5A3F" }}>Загружаю настройки...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px" }}>
      <Link href="/settings" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6B6058", textDecoration: "none", marginBottom: 16 }}>
        <ArrowLeft size={14} /> Назад в настройки
      </Link>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1C1C1E" }}>Публичная запись</h1>
        <p style={{ fontSize: 14, color: "#6B6058", marginTop: 4 }}>
          Клиенты бронируют время сами по ссылке — без вашего участия
        </p>
      </div>

      {error && (
        <p style={{ fontSize: 12.5, color: "#B91C1C", marginBottom: 12 }}>{error}</p>
      )}

      {/* Переключатель + ссылка */}
      <Card className="mb-4">
        <CardContent className="pt-6">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isActive ? 16 : 0 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E" }}>Публичная запись включена</div>
              <div style={{ fontSize: 12, color: "#6F5A3F", marginTop: 2 }}>
                {isActive ? "Ссылка активна, клиенты могут бронировать время" : "Страница бронирования отключена"}
              </div>
            </div>
            <button
              onClick={toggleActive}
              disabled={saving}
              style={{
                width: 44, height: 26, borderRadius: 13,
                background: isActive ? "#2D6A5C" : "#E5DFD5",
                border: "none", cursor: "pointer", position: "relative",
                transition: "background 0.2s", flexShrink: 0,
              }}
            >
              <motion.div
                animate={{ x: isActive ? 20 : 2 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: "absolute", top: 2, width: 22, height: 22,
                  borderRadius: "50%", background: "#fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
            </button>
          </div>

          <AnimatePresence>
            {isActive && bookingUrl && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                style={{ overflow: "hidden" }}
              >
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", background: "#F5F3EF", borderRadius: 8,
                }}>
                  <LinkIcon size={14} style={{ color: "#2D6A5C", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: "#1C1C1E", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {bookingUrl}
                  </span>
                  <Button size="sm" variant="secondary" onClick={copyLink}>
                    {copied ? <><Check size={13} style={{ marginRight: 4 }} /> Скопировано</> : <><Copy size={13} style={{ marginRight: 4 }} /> Скопировать</>}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Часовой пояс — рабочие часы ниже трактуются именно в нём */}
      <Card className="mb-4">
        <CardContent className="pt-6">
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", marginBottom: 6 }}>Часовой пояс</h3>
          <p style={{ fontSize: 12.5, color: "#6F5A3F", marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
            В нём указаны рабочие часы ниже и в нём клиент видит свободное время.
            Если пояс указан неверно, сессия запишется не на то время.
          </p>
          <select
            value={timezone}
            onChange={e => {
              const tz = e.target.value;
              setTimezone(tz);
              save({ timezone: tz });
            }}
            disabled={saving}
            style={{
              width: "100%", maxWidth: 420, padding: "9px 12px", border: "1px solid #E5DFD5",
              borderRadius: 8, fontSize: 13, color: "#1C1C1E", fontFamily: "var(--font-sans)", background: "#FFFFFF",
            }}
          >
            {TIMEZONE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {browserTimeZone && browserTimeZone !== timezone && (
            <p style={{ fontSize: 12, color: "#92400E", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>
              На этом устройстве часовой пояс — {browserTimeZone}, а в настройках указан другой.
              Если вы работаете отсюда, выберите пояс этого устройства.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Рабочие часы */}
      <Card className="mb-4">
        <CardContent className="pt-6">
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", marginBottom: 14 }}>Рабочие часы</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {DAY_LABELS.map(({ key, label }) => {
              const window = workingHours[key];
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 130, fontSize: 13, color: "#1C1C1E", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!window}
                      onChange={() => toggleDayOff(key)}
                      style={{ cursor: "pointer" }}
                    />
                    Выходной
                  </label>
                  <span style={{ fontSize: 13, color: "#6B6058", minWidth: 90 }}>{label}</span>
                  {window ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="time"
                        value={window[0]}
                        onChange={e => updateDayTime(key, 0, e.target.value)}
                        onBlur={commitWorkingHours}
                        style={{ padding: "5px 8px", border: "1px solid #E5DFD5", borderRadius: 6, fontSize: 12.5, fontFamily: "var(--font-sans)", color: "#1C1C1E", background: "#FFFFFF" }}
                      />
                      <span style={{ fontSize: 12, color: "#6B6058" }}>—</span>
                      <input
                        type="time"
                        value={window[1]}
                        onChange={e => updateDayTime(key, 1, e.target.value)}
                        onBlur={commitWorkingHours}
                        style={{ padding: "5px 8px", border: "1px solid #E5DFD5", borderRadius: 6, fontSize: 12.5, fontFamily: "var(--font-sans)", color: "#1C1C1E", background: "#FFFFFF" }}
                      />
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: "#6B6058" }}>—</span>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Слоты на конкретные даты */}
      <DateSlotsEditor
        overrides={dateOverrides}
        workingHours={workingHours}
        durationMinutes={duration}
        bufferMinutes={buffer}
        maxAdvanceDays={maxAdvance}
        timeZone={timezone}
        disabled={saving}
        onChange={next => {
          setDateOverrides(next);
          save({ date_overrides: next });
        }}
      />

      {/* Профиль, услуги и отзывы для публичной страницы */}
      <BookingProfileEditor
        profile={profile}
        services={services}
        reviews={reviews}
        saving={saving}
        onSave={async patch => {
          const ok = await save(patch);
          if (ok) {
            if (patch.profile) setProfile(patch.profile);
            if (patch.services) setServices(patch.services);
            if (patch.reviews) setReviews(patch.reviews);
          }
          return ok;
        }}
      />

      {/* Параметры сессии */}
      <Card>
        <CardContent className="pt-6">
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", marginBottom: 14 }}>Параметры записи</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <NumberField label="Длительность сессии" unit="мин" value={duration} min={10} max={480}
              onCommit={v => { setDuration(v); save({ session_duration_minutes: v }); }} />
            <NumberField label="Буфер между сессиями" unit="мин" value={buffer} min={0} max={240}
              onCommit={v => { setBuffer(v); save({ buffer_minutes: v }); }} />
            <NumberField label="Записаться можно не позже чем за" unit="ч" value={minNotice} min={0} max={720}
              onCommit={v => { setMinNotice(v); save({ min_notice_hours: v }); }} />
            <NumberField label="Максимум дней вперёд" unit="дн." value={maxAdvance} min={1} max={365}
              onCommit={v => { setMaxAdvance(v); save({ max_advance_days: v }); }} />
          </div>
        </CardContent>
      </Card>

      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{
              position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
              background: "#157347", color: "#fff", padding: "12px 20px",
              borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 60,
              boxShadow: "0 4px 12px rgba(27, 175, 122, 0.3)",
            }}
          >
            {notification}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Числовое поле: значение применяется по уходу из поля или Enter, если оно в допустимых пределах. */
function NumberField({ label, unit, value, min, max, onCommit }: {
  label: string; unit: string; value: number; min: number; max: number; onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const n = Number(text);
  const valid = text.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
  function commit() {
    if (valid && n !== value) onCommit(n);
    else if (!valid) setText(String(value));
  }
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6058" }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={text}
          onChange={e => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          style={{ ...selectStyle, marginTop: 0, width: 110, borderColor: valid ? "#E5DFD5" : "#B91C1C" }}
        />
        <span style={{ fontSize: 13, color: "#6B6058" }}>{unit}</span>
        <span style={{ fontSize: 11, color: "#8A7F70" }}>от {min} до {max}</span>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  display: "block", marginTop: 6, width: "100%",
  padding: "8px 10px", border: "1px solid #E5DFD5",
  borderRadius: 8, fontSize: 13, background: "#FFFFFF",
  fontFamily: "var(--font-sans)", color: "#1C1C1E",
};

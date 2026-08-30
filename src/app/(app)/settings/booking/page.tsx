"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Copy, Check, Link as LinkIcon } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";

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
  session_duration_minutes: number;
  buffer_minutes: number;
  min_notice_hours: number;
  max_advance_days: number;
  is_active: boolean;
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
  const [duration, setDuration] = useState(50);
  const [buffer, setBuffer] = useState(10);
  const [minNotice, setMinNotice] = useState(2);
  const [maxAdvance, setMaxAdvance] = useState(30);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/booking-settings");
        const data = await res.json();
        if (!cancelled && res.ok && data.settings) {
          const s: BookingSettings = data.settings;
          setSlug(s.public_slug);
          setIsActive(s.is_active);
          setWorkingHours({ ...DEFAULT_HOURS, ...s.working_hours });
          setDuration(s.session_duration_minutes);
          setBuffer(s.buffer_minutes);
          setMinNotice(s.min_notice_hours);
          setMaxAdvance(s.max_advance_days);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(patch: Partial<{
    working_hours: WorkingHours;
    session_duration_minutes: number;
    buffer_minutes: number;
    min_notice_hours: number;
    max_advance_days: number;
    is_active: boolean;
  }>) {
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
      } else {
        setError(data.error ?? "Не удалось сохранить настройки");
      }
    } catch {
      setError("Не удалось связаться с сервером");
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
        <p style={{ fontSize: 13, color: "#8C7355" }}>Загружаю настройки...</p>
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
        <p style={{ fontSize: 12.5, color: "#EF4444", marginBottom: 12 }}>{error}</p>
      )}

      {/* Переключатель + ссылка */}
      <Card className="mb-4">
        <CardContent className="pt-6">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isActive ? 16 : 0 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E" }}>Публичная запись включена</div>
              <div style={{ fontSize: 12, color: "#8C7355", marginTop: 2 }}>
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
                        style={{ padding: "5px 8px", border: "1px solid #E5DFD5", borderRadius: 6, fontSize: 12.5, fontFamily: "var(--font-sans)" }}
                      />
                      <span style={{ fontSize: 12, color: "#8C7355" }}>—</span>
                      <input
                        type="time"
                        value={window[1]}
                        onChange={e => updateDayTime(key, 1, e.target.value)}
                        onBlur={commitWorkingHours}
                        style={{ padding: "5px 8px", border: "1px solid #E5DFD5", borderRadius: 6, fontSize: 12.5, fontFamily: "var(--font-sans)" }}
                      />
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: "#8C7355" }}>—</span>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Параметры сессии */}
      <Card>
        <CardContent className="pt-6">
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", marginBottom: 14 }}>Параметры записи</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6058" }}>Длительность сессии</label>
              <select
                value={duration}
                onChange={e => { const v = Number(e.target.value); setDuration(v); save({ session_duration_minutes: v }); }}
                style={selectStyle}
              >
                <option value={30}>30 минут</option>
                <option value={50}>50 минут</option>
                <option value={60}>60 минут</option>
                <option value={90}>90 минут</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6058" }}>Буфер между сессиями</label>
              <select
                value={buffer}
                onChange={e => { const v = Number(e.target.value); setBuffer(v); save({ buffer_minutes: v }); }}
                style={selectStyle}
              >
                <option value={0}>Без буфера</option>
                <option value={10}>10 минут</option>
                <option value={15}>15 минут</option>
                <option value={30}>30 минут</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6058" }}>Минимальное уведомление</label>
              <select
                value={minNotice}
                onChange={e => { const v = Number(e.target.value); setMinNotice(v); save({ min_notice_hours: v }); }}
                style={selectStyle}
              >
                <option value={1}>1 час</option>
                <option value={2}>2 часа</option>
                <option value={4}>4 часа</option>
                <option value={24}>24 часа</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6058" }}>Максимум дней вперёд</label>
              <select
                value={maxAdvance}
                onChange={e => { const v = Number(e.target.value); setMaxAdvance(v); save({ max_advance_days: v }); }}
                style={selectStyle}
              >
                <option value={7}>7 дней</option>
                <option value={14}>14 дней</option>
                <option value={30}>30 дней</option>
                <option value={60}>60 дней</option>
              </select>
            </div>
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
              background: "#1BAF7A", color: "#fff", padding: "12px 20px",
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

const selectStyle: React.CSSProperties = {
  display: "block", marginTop: 6, width: "100%",
  padding: "8px 10px", border: "1px solid #E5DFD5",
  borderRadius: 8, fontSize: 13, background: "#FFFFFF",
  fontFamily: "var(--font-sans)", color: "#1C1C1E",
};

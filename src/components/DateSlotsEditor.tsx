"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";
import { generateAvailableSlots, type DateOverrides, type WorkingHours } from "@/lib/booking";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAYS_ACC = ["воскресеньям", "понедельникам", "вторникам", "средам", "четвергам", "пятницам", "субботам"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function ymd(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function weekdayOf(date: string) {
  return new Date(date + "T12:00:00Z").getUTCDay(); // 0 = вс
}
function todayLocal() {
  const n = new Date();
  return ymd(n.getFullYear(), n.getMonth(), n.getDate());
}
function addDays(date: string, days: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function formatLong(date: string) {
  const d = new Date(date + "T12:00:00Z");
  return d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

const navBtn: React.CSSProperties = {
  width: 30, height: 30, border: "1px solid #E5DFD5", borderRadius: 8, background: "#fff",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0,
};

const DAY_START = 6 * 60; // шкала с 06:00
const DAY_END = 23 * 60 + 30; // до 23:30
const PX_PER_MIN = 1.25;
const SNAP = 5;

function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function toTime(min: number) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

/**
 * Шкала дня: слоты — блоки по длительности сессии. Клик по пустому месту добавляет слот,
 * блок можно перетащить (шаг 5 минут), крестик убирает.
 */
function DayTimeline({
  times,
  durationMinutes,
  disabled,
  onChange,
}: {
  times: string[];
  durationMinutes: number;
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ time: string; start: number } | null>(null);
  const dragRef = useRef<{ time: string; orig: number; startX: number; cur: number } | null>(null);
  const timesRef = useRef(times);
  timesRef.current = times;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const starts = times.map(toMin);
  const minStart = Math.min(DAY_START, ...starts);
  const maxEnd = Math.max(DAY_END, ...starts.map(m => m + durationMinutes));
  const widthPx = (maxEnd - minStart) * PX_PER_MIN;
  const x = (min: number) => (min - minStart) * PX_PER_MIN;

  // Стартовая прокрутка к 08:00
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, x(8 * 60) - 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function overlaps(start: number, ignore?: number) {
    return timesRef.current.map(toMin).some(o => o !== ignore && Math.abs(o - start) < durationMinutes);
  }
  function snap(min: number) {
    return Math.round(min / SNAP) * SNAP;
  }
  function minuteAt(clientX: number) {
    const rect = laneRef.current!.getBoundingClientRect();
    return minStart + (clientX - rect.left) / PX_PER_MIN;
  }
  function clampStart(min: number) {
    return Math.max(0, Math.min(24 * 60 - durationMinutes, min));
  }

  function onLaneMove(e: React.PointerEvent) {
    if (disabled || dragRef.current) return;
    const m = clampStart(snap(minuteAt(e.clientX) - durationMinutes / 2));
    setGhost(overlaps(m) ? null : m);
  }
  function onLaneClick(e: React.MouseEvent) {
    if (disabled || dragRef.current) return;
    const m = clampStart(snap(minuteAt(e.clientX) - durationMinutes / 2));
    if (overlaps(m)) return;
    onChange([...times, toTime(m)].sort());
    setGhost(null);
  }

  function startDrag(e: React.PointerEvent, time: string) {
    if (disabled) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const orig = toMin(time);
    dragRef.current = { time, orig, startX: e.clientX, cur: orig };
    setDrag({ time, start: orig });
    setGhost(null);

    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = clampStart(snap(d.orig + (ev.clientX - d.startX) / PX_PER_MIN));
      if (!overlaps(next, d.orig)) {
        d.cur = next;
        setDrag({ time: d.time, start: next });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (d && d.cur !== d.orig) {
        const rest = timesRef.current.filter(t => t !== d.time);
        onChangeRef.current([...rest, toTime(d.cur)].sort());
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  const hours: number[] = [];
  for (let h = Math.ceil(minStart / 60); h * 60 <= maxEnd; h++) hours.push(h);

  return (
    <div>
      <div ref={scrollRef} style={{ overflowX: "auto", paddingBottom: 6 }}>
        <div style={{ width: widthPx, position: "relative" }}>
          {/* Часы */}
          <div style={{ position: "relative", height: 18 }}>
            {hours.map(h => (
              <span key={h} style={{ position: "absolute", left: x(h * 60), transform: "translateX(-50%)", fontSize: 10.5, color: "#6B6058" }}>
                {pad(h)}:00
              </span>
            ))}
          </div>
          {/* Дорожка */}
          <div
            ref={laneRef}
            onPointerMove={onLaneMove}
            onPointerLeave={() => setGhost(null)}
            onClick={onLaneClick}
            style={{
              position: "relative", height: 52, background: "#FFFFFF", border: "1px solid #E5DFD5", borderRadius: 8,
              cursor: disabled ? "default" : "copy", touchAction: "pan-x",
            }}
          >
            {hours.map(h => (
              <div key={h} style={{ position: "absolute", left: x(h * 60), top: 0, bottom: 0, width: 1, background: "#EFEAE0" }} />
            ))}
            {ghost !== null && (
              <div
                style={{
                  position: "absolute", left: x(ghost), width: durationMinutes * PX_PER_MIN, top: 6, bottom: 6, borderRadius: 6,
                  border: "1.5px dashed #2D6A5C", background: "#2D6A5C14", pointerEvents: "none",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, color: "#2D6A5C", fontWeight: 600,
                }}
              >
                +{toTime(ghost)}
              </div>
            )}
            {times.map(t => {
              const dragging = drag?.time === t;
              const start = dragging ? drag!.start : toMin(t);
              return (
                <div
                  key={t}
                  onPointerDown={e => startDrag(e, t)}
                  onClick={e => e.stopPropagation()}
                  title="Перетащите, чтобы сдвинуть"
                  style={{
                    position: "absolute", left: x(start), width: durationMinutes * PX_PER_MIN, top: 6, bottom: 6,
                    borderRadius: 6, background: dragging ? "#2D6A5C" : "#3E8272", color: "#fff",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    fontSize: 11.5, fontWeight: 700, cursor: disabled ? "default" : "grab", touchAction: "none", userSelect: "none",
                    boxShadow: dragging ? "0 4px 10px rgba(45,106,92,0.35)" : "none", zIndex: dragging ? 3 : 1,
                  }}
                >
                  <span>{toTime(start)}</span>
                  <span style={{ fontSize: 9.5, fontWeight: 500, opacity: 0.85 }}>{toTime(start + durationMinutes)}</span>
                  <button
                    type="button"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); if (!disabled) onChange(times.filter(x2 => x2 !== t)); }}
                    aria-label={`Убрать ${t}`}
                    style={{
                      position: "absolute", top: -7, right: -7, width: 16, height: 16, borderRadius: 8, border: "1px solid #E5DFD5",
                      background: "#fff", color: "#1C1C1E", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, cursor: "pointer",
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "#6F5A3F", margin: "6px 0 0", lineHeight: 1.5 }}>
        Нажмите на свободное место, чтобы добавить слот ({durationMinutes} мин). Блок можно перетащить, крестик убирает.
      </p>
    </div>
  );
}

type Mode = "default" | "closed" | "custom";

export function DateSlotsEditor({
  overrides,
  workingHours,
  durationMinutes,
  bufferMinutes,
  maxAdvanceDays,
  timeZone,
  disabled,
  onChange,
}: {
  overrides: DateOverrides;
  workingHours: WorkingHours;
  durationMinutes: number;
  bufferMinutes: number;
  maxAdvanceDays: number;
  timeZone: string;
  disabled?: boolean;
  onChange: (next: DateOverrides) => void;
}) {
  const today = todayLocal();
  const lastDate = addDays(today, maxAdvanceDays);
  const [view, setView] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /** Слоты на дату по обычному расписанию — подсказка и стартовый набор для правки. */
  function defaultTimes(date: string): string[] {
    return generateAvailableSlots({
      fromDate: date,
      toDate: date,
      workingHours,
      sessionDurationMinutes: durationMinutes,
      bufferMinutes,
      minNoticeHours: 0,
      occupied: [],
      now: new Date(0),
      timeZone,
    }).map(s => s.time);
  }

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const offset = (first.getDay() + 6) % 7; // понедельник первым
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const out: (string | null)[] = Array(offset).fill(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(ymd(view.y, view.m, d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view]);

  function modeOf(date: string): Mode {
    const o = overrides[date];
    if (!o) return "default";
    return o.length === 0 ? "closed" : "custom";
  }

  function commit(next: DateOverrides) {
    onChange(next);
  }

  function setMode(date: string, mode: Mode) {
    const next = { ...overrides };
    if (mode === "default") delete next[date];
    else if (mode === "closed") next[date] = [];
    else {
      const base = defaultTimes(date);
      next[date] = base.length > 0 ? base : ["12:00"];
    }
    setMessage(null);
    commit(next);
  }

  function repeatForWeekday(date: string) {
    const source = overrides[date];
    const wd = weekdayOf(date);
    const next = { ...overrides };
    let count = 0;
    for (let d = addDays(date, 7); d <= lastDate; d = addDays(d, 7)) {
      if (weekdayOf(d) !== wd) continue;
      if (source) next[d] = [...source];
      else delete next[d];
      count++;
    }
    commit(next);
    setMessage(count > 0 ? `Применено ещё к ${count} дн. до ${formatLong(lastDate)}` : "Дальше в пределах «максимум дней вперёд» таких дней нет");
  }

  const prevDisabled = view.y === new Date().getFullYear() && view.m === new Date().getMonth();
  const mode = selected ? modeOf(selected) : "default";
  const customTimes = selected ? overrides[selected] ?? [] : [];

  return (
    <Card className="mb-4">
      <CardContent className="pt-6">
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", marginBottom: 6 }}>Слоты на конкретные даты</h3>
        <p style={{ fontSize: 12.5, color: "#6F5A3F", marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
          Выберите день и задайте для него свои времена приёма (любые, например 11:00, 13:15, 18:00) или закройте день целиком.
          Остальные дни работают по рабочим часам выше.
        </p>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, maxWidth: 360 }}>
          <button
            type="button"
            onClick={() => setView(v => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
            disabled={prevDisabled}
            style={{ ...navBtn, cursor: prevDisabled ? "default" : "pointer", opacity: prevDisabled ? 0.35 : 1 }}
            aria-label="Предыдущий месяц"
          >
            <ChevronLeft size={16} color="#1C1C1E" />
          </button>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E" }}>{MONTHS[view.m]} {view.y}</span>
          <button
            type="button"
            onClick={() => setView(v => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
            style={navBtn}
            aria-label="Следующий месяц"
          >
            <ChevronRight size={16} color="#1C1C1E" />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, maxWidth: 360 }}>
          {WEEKDAYS_SHORT.map(w => (
            <div key={w} style={{ textAlign: "center", fontSize: 11, color: "#6F5A3F", padding: "2px 0" }}>{w}</div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={i} />;
            const inRange = date >= today && date <= lastDate;
            const m = modeOf(date);
            const isSel = date === selected;
            const bg = isSel ? "#2D6A5C" : m === "custom" ? "#E8F3EF" : m === "closed" ? "#F1ECE4" : "#FFFFFF";
            const color = isSel ? "#fff" : !inRange ? "#C9C1B5" : m === "closed" ? "#8A7F70" : "#1C1C1E";
            return (
              <button
                key={date}
                type="button"
                disabled={!inRange}
                onClick={() => { setSelected(date); setMessage(null); }}
                title={m === "custom" ? "Свои слоты" : m === "closed" ? "Закрыто" : undefined}
                style={{
                  height: 38, borderRadius: 8, border: m === "custom" && !isSel ? "1px solid #2D6A5C" : "1px solid #E5DFD5",
                  background: bg, color, fontSize: 13, fontWeight: isSel || m !== "default" ? 700 : 500,
                  textDecoration: m === "closed" && !isSel ? "line-through" : "none",
                  cursor: inRange ? "pointer" : "default", fontFamily: "var(--font-sans)",
                }}
              >
                {Number(date.slice(8))}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11.5, color: "#6F5A3F", flexWrap: "wrap" }}>
          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "#E8F3EF", border: "1px solid #2D6A5C", marginRight: 4 }} />свои слоты</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "#F1ECE4", marginRight: 4 }} />закрыто</span>
        </div>

        <p style={{ fontSize: 12, color: "#6F5A3F", margin: "8px 0 0", lineHeight: 1.5 }}>
          Выбрать можно даты до {formatLong(lastDate)}: клиенты видят запись не дальше, чем «Максимум дней вперёд» ({maxAdvanceDays}) в параметрах ниже. Хотите дальше — увеличьте его.
        </p>

        {selected && (
          <div style={{ marginTop: 16, padding: 14, background: "#F5F3EF", borderRadius: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1C1C1E", marginBottom: 10, textTransform: "capitalize" }}>{formatLong(selected)}</div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {([
                ["default", "По расписанию"],
                ["custom", "Свои времена"],
                ["closed", "Закрыть день"],
              ] as [Mode, string][]).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  disabled={disabled}
                  onClick={() => setMode(selected, k)}
                  style={{
                    padding: "6px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    border: mode === k ? "1px solid #2D6A5C" : "1px solid #E5DFD5",
                    background: mode === k ? "#2D6A5C" : "#fff", color: mode === k ? "#fff" : "#1C1C1E",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "default" && (
              <p style={{ fontSize: 12.5, color: "#6F5A3F", margin: 0 }}>
                {defaultTimes(selected).length > 0
                  ? `По расписанию: ${defaultTimes(selected).join(", ")}`
                  : "По расписанию в этот день приёма нет"}
              </p>
            )}
            {mode === "closed" && (
              <p style={{ fontSize: 12.5, color: "#6F5A3F", margin: 0 }}>Клиенты не смогут записаться на этот день.</p>
            )}
            {mode === "custom" && (
              <DayTimeline
                times={customTimes}
                durationMinutes={durationMinutes}
                disabled={disabled}
                onChange={next => commit({ ...overrides, [selected]: next })}
              />
            )}

            <div style={{ marginTop: 12 }}>
              <Button size="sm" variant="secondary" onClick={() => repeatForWeekday(selected)} disabled={disabled}>
                Повторить по {WEEKDAYS_ACC[weekdayOf(selected)]} до конца периода
              </Button>
              {message && <span style={{ fontSize: 12, color: "#2D6A5C", marginLeft: 10 }}>{message}</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

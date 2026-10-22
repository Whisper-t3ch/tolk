"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";
import { generateAvailableSlots, isValidTime, type DateOverrides, type WorkingHours } from "@/lib/booking";

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
  const [newTime, setNewTime] = useState("12:00");
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

  function removeTime(date: string, t: string) {
    const cur = overrides[date] ?? [];
    const rest = cur.filter(x => x !== t);
    // Убрали последнее время — это уже «выходной», а не «по расписанию»
    commit({ ...overrides, [date]: rest });
  }

  function addTime(date: string) {
    if (!isValidTime(newTime)) return;
    const cur = overrides[date] ?? [];
    if (cur.includes(newTime)) return;
    commit({ ...overrides, [date]: [...cur, newTime].sort() });
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

  const chip: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px 4px 10px",
    borderRadius: 14, background: "#E8F3EF", color: "#2D6A5C", fontSize: 12.5, fontWeight: 600,
  };

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
            style={{ background: "none", border: "none", cursor: prevDisabled ? "default" : "pointer", opacity: prevDisabled ? 0.3 : 1 }}
            aria-label="Предыдущий месяц"
          >
            <ChevronLeft size={18} />
          </button>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E" }}>{MONTHS[view.m]} {view.y}</span>
          <button
            type="button"
            onClick={() => setView(v => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
            style={{ background: "none", border: "none", cursor: "pointer" }}
            aria-label="Следующий месяц"
          >
            <ChevronRight size={18} />
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
              <div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {customTimes.length === 0 && <span style={{ fontSize: 12.5, color: "#6F5A3F" }}>Времён нет — день закрыт. Добавьте время ниже.</span>}
                  {customTimes.map(t => (
                    <span key={t} style={chip}>
                      {t}
                      <button
                        type="button"
                        onClick={() => removeTime(selected, t)}
                        aria-label={`Убрать ${t}`}
                        style={{ background: "none", border: "none", cursor: "pointer", display: "inline-flex", padding: 2, color: "#2D6A5C" }}
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="time"
                    value={newTime}
                    onChange={e => setNewTime(e.target.value)}
                    style={{ padding: "5px 8px", border: "1px solid #E5DFD5", borderRadius: 6, fontSize: 12.5, fontFamily: "var(--font-sans)" }}
                  />
                  <Button size="sm" variant="secondary" onClick={() => addTime(selected)} disabled={disabled}>Добавить время</Button>
                </div>
              </div>
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

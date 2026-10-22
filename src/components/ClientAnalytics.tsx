"use client";
import { useEffect, useMemo, useState } from "react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, CardContent } from "@/components/ui";

export interface AnalyticsTest {
  id: string;
  test_type: string;
  score: number;
  max_score: number;
  interpretation: string | null;
  status: "pending" | "completed";
  created_at: string;
  title?: string | null;
}

// У этих шкал больший балл = лучше. У остальных (PHQ-9, GAD-7, BDI…) меньше = лучше.
const HIGHER_IS_BETTER = new Set(["WHO5"]);
const GOOD = "#157347";
const BAD = "#B91C1C";
const NEUTRAL = "#6F5A3F";

function fmtDate(iso: string, timeZone: string) {
  return new Date(iso).toLocaleDateString("ru", { day: "numeric", month: "short", timeZone });
}

/** Карточка на каждую методику: график по датам, последний результат с интерпретацией и изменение с прошлого раза. */
export function TestsAnalytics({
  tests,
  nameOf,
  timeZone,
}: {
  tests: AnalyticsTest[];
  nameOf: (t: AnalyticsTest) => string;
  timeZone: string;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, AnalyticsTest[]>();
    for (const t of tests.filter(x => x.status === "completed")) {
      const arr = map.get(t.test_type) ?? [];
      arr.push(t);
      map.set(t.test_type, arr);
    }
    return Array.from(map.entries()).map(([type, arr]) => ({
      type,
      items: arr.sort((a, b) => a.created_at.localeCompare(b.created_at)),
    }));
  }, [tests]);

  if (groups.length === 0) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
      {groups.map(({ type, items }) => {
        const last = items[items.length - 1];
        const prev = items.length > 1 ? items[items.length - 2] : null;
        const first = items[0];
        const delta = prev ? last.score - prev.score : null;
        const higherBetter = HIGHER_IS_BETTER.has(type);
        let color = NEUTRAL;
        if (delta !== null && delta !== 0) color = (delta > 0) === higherBetter ? GOOD : BAD;
        const Icon = delta === null || delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
        const data = items.map(t => ({ date: fmtDate(t.created_at, timeZone), score: t.score }));
        return (
          <div key={type} style={{ border: "1px solid #E5DFD5", borderRadius: 12, padding: 14, background: "#FFFFFF" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1C1C1E" }}>{nameOf(last)}</div>
              {delta !== null && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 14, background: `${color}18`, color, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                  <Icon size={12} /> {delta > 0 ? "+" : ""}{delta}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: "#1C1C1E" }}>
              Сейчас <b>{last.score}</b> из {last.max_score}
              {first !== last && <span style={{ color: "#6B6058" }}> · в начале {first.score}</span>}
            </div>
            {last.interpretation && <div style={{ fontSize: 12, color: "#6F5A3F", marginTop: 2, lineHeight: 1.45 }}>{last.interpretation}</div>}
            <div style={{ marginTop: 8 }}>
              {items.length >= 2 ? (
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5DFD5" />
                    <XAxis dataKey="date" stroke="#6F5A3F" style={{ fontSize: 10.5 }} />
                    <YAxis domain={[0, last.max_score]} stroke="#6F5A3F" style={{ fontSize: 10.5 }} />
                    <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E5DFD5" }} />
                    <Line type="monotone" dataKey="score" name="Балл" stroke="#2D6A5C" strokeWidth={2} dot={{ fill: "#2D6A5C", r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ fontSize: 12, color: "#6F5A3F", margin: 0 }}>Один замер ({fmtDate(last.created_at, timeZone)}). График появится после второго.</p>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#8A7F70", marginTop: 4 }}>
              Замеров: {items.length}{higherBetter ? " · чем выше, тем лучше" : " · чем ниже, тем лучше"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const METRICS: { key: string; label: string; color: string }[] = [
  { key: "general", label: "Общее состояние", color: "#2D6A5C" },
  { key: "wellbeing", label: "Самочувствие", color: "#1BAF7A" },
  { key: "anxiety", label: "Тревога", color: "#F59E0B" },
  { key: "depression", label: "Подавленность", color: "#B91C1C" },
];

interface ProgressPoint { id: string; metric_type: string; value: number; note: string | null; recorded_at: string }

/** Оценка состояния клиента по шкале 0–10 после встреч: хранится в client_progress, график по метрикам. */
export function ProgressCard({ clientId, timeZone }: { clientId: string; timeZone: string }) {
  const [points, setPoints] = useState<ProgressPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState("general");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/clients/${clientId}/progress`);
      const data = await res.json();
      if (res.ok) setPoints(data.progress ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function save() {
    const v = Number(value);
    if (value.trim() === "" || !Number.isFinite(v) || v < 0 || v > 10) { setError("Оценка от 0 до 10"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metric_type: metric, value: v, note: note.trim() || undefined }),
      });
      if (res.ok) { setValue(""); setNote(""); await load(); }
      else setError((await res.json().catch(() => ({}))).error ?? "Не удалось сохранить");
    } catch {
      setError("Не удалось связаться с сервером");
    } finally {
      setSaving(false);
    }
  }

  // Одна строка на дату, колонка на метрику
  const { chartData, usedMetrics } = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    const used = new Set<string>();
    for (const p of points) {
      const d = fmtDate(p.recorded_at, timeZone);
      const row = byDate.get(d) ?? { date: d };
      row[p.metric_type] = p.value;
      byDate.set(d, row);
      used.add(p.metric_type);
    }
    return { chartData: Array.from(byDate.values()), usedMetrics: METRICS.filter(m => used.has(m.key)) };
  }, [points, timeZone]);

  const notes = points.filter(p => p.note).slice(-3).reverse();
  const input: React.CSSProperties = { padding: "7px 10px", border: "1px solid #E5DFD5", borderRadius: 6, fontSize: 12.5, color: "#1C1C1E", background: "#FFFFFF", fontFamily: "var(--font-sans)" };

  return (
    <Card>
      <CardContent className="pt-6">
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", marginBottom: 4 }}>Динамика состояния</h3>
        <p style={{ fontSize: 12.5, color: "#6F5A3F", margin: "0 0 12px", lineHeight: 1.5 }}>
          Отмечайте состояние клиента после встреч (0 — очень плохо, 10 — отлично), чтобы видеть динамику между тестами.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <select value={metric} onChange={e => setMetric(e.target.value)} style={input}>
            {METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <input type="number" min={0} max={10} step={1} value={value} onChange={e => setValue(e.target.value)} placeholder="0–10" style={{ ...input, width: 80 }} />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Заметка (необязательно)" style={{ ...input, flex: 1, minWidth: 160 }} />
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Сохраняю…" : "Отметить"}</Button>
        </div>
        {error && <p style={{ fontSize: 12, color: "#B91C1C", margin: "0 0 8px" }}>{error}</p>}
        {loading ? (
          <p style={{ fontSize: 12, color: "#6F5A3F" }}>Загрузка…</p>
        ) : chartData.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "#6F5A3F", margin: 0 }}>Пока нет оценок. Первая отметка запустит график.</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5DFD5" />
                <XAxis dataKey="date" stroke="#6F5A3F" style={{ fontSize: 11 }} />
                <YAxis domain={[0, 10]} stroke="#6F5A3F" style={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E5DFD5" }} />
                {usedMetrics.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                {usedMetrics.map(m => (
                  <Line key={m.key} type="monotone" dataKey={m.key} name={m.label} stroke={m.color} strokeWidth={2} dot={{ fill: m.color, r: 3 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
            {notes.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                {notes.map(n => (
                  <div key={n.id} style={{ fontSize: 12, color: "#6B6058" }}>
                    <b style={{ color: "#1C1C1E" }}>{fmtDate(n.recorded_at, timeZone)}</b> · {n.note}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

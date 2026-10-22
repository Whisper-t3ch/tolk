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


export interface AiAnalysis {
  id: string;
  kind: "overview" | "test" | "session";
  ref: string | null;
  content: Record<string, string>;
  score: number | null;
  created_at: string;
}

/** ИИ-анализы клиента: список сохранённых + запуск по кнопке (каждый запуск стоит 1 запрос лимита). */
export function useAiAnalyses(clientId: string) {
  const [list, setList] = useState<AiAnalysis[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientId}/ai-analysis`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.analyses) setList(d.analyses); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [clientId]);

  async function generate(kind: AiAnalysis["kind"], ref?: string) {
    const key = `${kind}:${ref ?? ""}`;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/ai-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ref }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.analysis) {
        setList(prev => [data.analysis as AiAnalysis, ...prev]);
        return data.analysis as AiAnalysis;
      }
      setError(data.error ?? data.message ?? "Не удалось получить анализ");
    } catch {
      setError("Не удалось связаться с сервером");
    } finally {
      setBusy(null);
    }
    return null;
  }

  function latest(kind: AiAnalysis["kind"], ref?: string | null) {
    return list.find(a => a.kind === kind && (a.ref ?? null) === (ref ?? null)) ?? null;
  }

  return { list, busy, error, generate, latest };
}
export type AiState = ReturnType<typeof useAiAnalyses>;

export const OVERVIEW_LABELS: [string, string][] = [
  ["dynamics", "Динамика"], ["strengths", "Сильные стороны"], ["supports", "Точки опоры"], ["interventions", "Интервенции"],
  ["homework", "Домашние задания"], ["attention", "На что обратить внимание"], ["next_focus", "Фокус дальше"],
];
export const TEST_LABELS: [string, string][] = [
  ["summary", "Вывод"], ["dynamics", "Динамика"], ["interpretation", "Как читать результат"], ["recommendations", "Что обсудить"],
];
export const SESSION_LABELS: [string, string][] = [
  ["score_rationale", "На чём основана оценка"], ["key_themes", "Ключевые темы"], ["strengths", "Сильные стороны"], ["supports", "Точки опоры"],
  ["interventions", "Интервенции"], ["homework", "Домашние задания"], ["next_focus", "Фокус дальше"],
];

export function AnalysisSections({ content, labels }: { content: Record<string, string>; labels: [string, string][] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {labels.filter(([k]) => content[k]).map(([k, label]) => (
        <div key={k}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6F5A3F", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
          <div style={{ fontSize: 12.5, color: "#1C1C1E", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{content[k]}</div>
        </div>
      ))}
    </div>
  );
}

export function AiButton({ busy, hasResult, onClick, disabled, what = "ИИ-анализ" }: { busy: boolean; hasResult: boolean; onClick: () => void; disabled?: boolean; what?: string }) {
  return (
    <Button size="sm" variant="secondary" onClick={onClick} disabled={busy || disabled}>
      {busy ? "Анализирую…" : `${hasResult ? "Обновить" : what} · −1 запрос`}
    </Button>
  );
}

const AI_NOTE = "Подготовлено ИИ по данным клиента, проверяйте выводы. Не диагноз.";

/** Обзор клиента по кнопке: протоколы сессий + тесты + отметки состояния. */
export function AiOverviewCard({ ai }: { ai: AiState }) {
  const cur = ai.latest("overview");
  const busy = ai.busy === "overview:";
  return (
    <Card>
      <CardContent className="pt-6">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>ИИ-обзор клиента</h3>
          <AiButton busy={busy} hasResult={!!cur} onClick={() => ai.generate("overview")} what="Сделать обзор" />
        </div>
        {ai.error && ai.busy === null && <p style={{ fontSize: 12, color: "#B91C1C", margin: "0 0 8px" }}>{ai.error}</p>}
        {cur ? (
          <>
            <p style={{ fontSize: 11.5, color: "#8A7F70", margin: "0 0 10px" }}>
              {new Date(cur.created_at).toLocaleString("ru", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
              {cur.content.sessions_used ? ` · протоколов: ${cur.content.sessions_used}` : ""}
              {cur.content.tests_used ? ` · замеров тестов: ${cur.content.tests_used}` : ""}
            </p>
            <AnalysisSections content={cur.content} labels={OVERVIEW_LABELS} />
            <p style={{ fontSize: 11, color: "#8A7F70", margin: "12px 0 0" }}>{AI_NOTE}</p>
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: "#6F5A3F", margin: 0, lineHeight: 1.5 }}>
            Сводка по всем протоколам сессий, тестам и отметкам состояния: динамика, сильные стороны, точки опоры, интервенции, домашние задания и на чём сфокусироваться дальше.
            Запускается только по кнопке и стоит 1 запрос из лимита ассистента.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Карточка на каждую методику: график по датам, последний результат с интерпретацией и изменение с прошлого раза. */
export function TestsAnalytics({
  tests,
  nameOf,
  timeZone,
  ai,
}: {
  tests: AnalyticsTest[];
  nameOf: (t: AnalyticsTest) => string;
  timeZone: string;
  ai: AiState;
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
    <>
    {ai.error && ai.busy === null && <p style={{ fontSize: 12, color: "#B91C1C", margin: "0 0 8px" }}>{ai.error}</p>}
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
            {(() => {
              const cur = ai.latest("test", type);
              return (
                <div style={{ marginTop: 10, borderTop: "1px solid #EFEAE0", paddingTop: 10 }}>
                  <AiButton busy={ai.busy === `test:${type}`} hasResult={!!cur} onClick={() => ai.generate("test", type)} what="ИИ-анализ теста" />
                  {cur && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, color: "#8A7F70", marginBottom: 6 }}>
                        {new Date(cur.created_at).toLocaleDateString("ru", { day: "numeric", month: "long" })} · {AI_NOTE}
                      </div>
                      <AnalysisSections content={cur.content} labels={TEST_LABELS} />
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
    </>
  );
}

const METRICS: { key: string; label: string; color: string }[] = [
  { key: "general", label: "Общее состояние", color: "#2D6A5C" },
  { key: "wellbeing", label: "Самочувствие", color: "#1BAF7A" },
  { key: "anxiety", label: "Тревога", color: "#F59E0B" },
  { key: "depression", label: "Подавленность", color: "#B91C1C" },
  { key: "ai", label: "ИИ (по сессиям)", color: "#7C5CBF" },
];

interface ProgressPoint { id: string; metric_type: string; value: number; note: string | null; recorded_at: string }

/** Оценка состояния клиента по шкале 0–10 после встреч: хранится в client_progress, график по метрикам. */
export function ProgressCard({ clientId, timeZone, ai }: { clientId: string; timeZone: string; ai: AiState }) {
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
    // ИИ-оценки по сессиям (разбор сессии по кнопке): на дату сессии
    const sessionScores = ai.list
      .filter(a => a.kind === "session" && a.score !== null)
      .map(a => ({ at: a.content.session_date || a.created_at, score: Number(a.score) }))
      .sort((x, y) => x.at.localeCompare(y.at));
    for (const a of sessionScores) {
      const d = fmtDate(a.at, timeZone);
      const row = byDate.get(d) ?? { date: d };
      row.ai = a.score;
      byDate.set(d, row);
      used.add("ai");
    }
    for (const p of points) {
      const d = fmtDate(p.recorded_at, timeZone);
      const row = byDate.get(d) ?? { date: d };
      row[p.metric_type] = p.value;
      byDate.set(d, row);
      used.add(p.metric_type);
    }
    return { chartData: Array.from(byDate.values()), usedMetrics: METRICS.filter(m => used.has(m.key)) };
  }, [points, timeZone, ai.list]);

  const notes = points.filter(p => p.note).slice(-3).reverse();
  const selectable = METRICS.filter(m => m.key !== "ai");
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
            {selectable.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <input type="number" min={0} max={10} step={1} value={value} onChange={e => setValue(e.target.value)} placeholder="0–10" style={{ ...input, width: 80 }} />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Заметка (необязательно)" style={{ ...input, flex: 1, minWidth: 160 }} />
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Сохраняю…" : "Отметить"}</Button>
        </div>
        {error && <p style={{ fontSize: 12, color: "#B91C1C", margin: "0 0 8px" }}>{error}</p>}
        {loading ? (
          <p style={{ fontSize: 12, color: "#6F5A3F" }}>Загрузка…</p>
        ) : chartData.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "#6F5A3F", margin: 0 }}>Пока нет оценок. Первая отметка (или ИИ-разбор сессии) запустит график.</p>
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

/** ИИ-разбор одной сессии по кнопке (транскрипт или протокол): темы, сильные стороны, интервенции и оценка состояния 0–10 для графика. */
export function SessionAiCard({ clientId, sessionId }: { clientId: string; sessionId: string }) {
  const ai = useAiAnalyses(clientId);
  const cur = ai.latest("session", sessionId);
  const busy = ai.busy === `session:${sessionId}`;
  return (
    <div style={{ marginTop: 16, padding: 16, background: "#FFFFFF", border: "1px solid #E5DFD5", borderRadius: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", margin: 0 }}>ИИ-разбор сессии</h3>
        <AiButton busy={busy} hasResult={!!cur} onClick={() => ai.generate("session", sessionId)} what="Разобрать сессию" />
      </div>
      {ai.error && ai.busy === null && <p style={{ fontSize: 12, color: "#B91C1C", margin: "0 0 8px" }}>{ai.error}</p>}
      {cur ? (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: "#2D6A5C" }}>{cur.score}</span>
            <span style={{ fontSize: 12.5, color: "#6F5A3F" }}>из 10: оценка состояния клиента на сессии (попадёт на график «Динамика состояния»)</span>
          </div>
          <AnalysisSections content={cur.content} labels={SESSION_LABELS} />
          <p style={{ fontSize: 11, color: "#8A7F70", margin: "12px 0 0" }}>
            {new Date(cur.created_at).toLocaleString("ru", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · {AI_NOTE}
          </p>
        </>
      ) : (
        <p style={{ fontSize: 12.5, color: "#6F5A3F", margin: 0, lineHeight: 1.5 }}>
          Разбор по транскрипту или протоколу: ключевые темы, сильные стороны, точки опоры, интервенции, домашние задания и оценка состояния клиента.
          Запускается только по кнопке и стоит 1 запрос из лимита ассистента.
        </p>
      )}
    </div>
  );
}

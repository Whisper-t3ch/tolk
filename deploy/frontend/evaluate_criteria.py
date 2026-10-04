#!/usr/bin/env python3
"""Оценка критериев «текущая ASR-ВМ не подходит» по stack_metrics.csv (monitor_stack.sh).

Пороги зафиксированы ДО теста (см. README, раздел «Критерии»). Использование:
    python3 evaluate_criteria.py stack_metrics.csv [--asr-jobs asr_jobs.csv]
asr_jobs.csv: phase,audio_sec,job_sec   (phase = baseline | loaded)
Код возврата: 0 — все критерии пройдены, 1 — есть провал.
"""
import csv, sys, statistics as st
from datetime import datetime

# ---- пороги (менять только до теста и только с согласования) ----
TTFB_P95_MAX_S = 1.5          # K1: p95 TTFB страницы на самой ВМ
TTFB_SPIKE_S, TTFB_SPIKE_RUN = 3.0, 3   # K1: 3 подряд замера > 3 с
CPU_IDLE_ASR_MAX = 75.0       # K2a: rolling-5мин CPU ВМ вне окон ASR
LOAD_PER_CPU_MAX = 1.25       # K2b: rolling-5мин load1/ncpu (в окнах ASR; признак вытеснения)
ASR_ACTIVE_CPU = 100.0        # контейнер asr > 100% (≥1 ядро) = идёт транскрибация
MEM_AVAIL_MIN_FRAC = 0.15     # K3: доступная RAM < 15% — провал (2+ замера подряд)
SWAP_USED_MAX_MB, SWAP_GROWTH_MAX_MB = 256, 100   # K4
HTTP_ERR_MAX_FRAC = 0.01      # K6
ASR_SLOWDOWN_MAX = 1.30       # K7: loaded/baseline по медиане «job_sec / audio_sec»
WINDOW_SEC = 300

def f(x):
    try: return float(x)
    except (TypeError, ValueError): return None

def ts(s): return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").timestamp()

def rolling_means(rows, key, window=WINDOW_SEC, pred=None):
    """Средние по скользящему окну; окно учитывается только если в нём ≥ 60% времени покрыто подходящими замерами."""
    pts = [(r["t"], f(r[key])) for r in rows if f(r[key]) is not None and (pred is None or pred(r))]
    out, j = [], 0
    for i in range(len(pts)):
        while pts[i][0] - pts[j][0] > window: j += 1
        span = pts[i][0] - pts[j][0]
        if span >= window * 0.9:
            out.append(statistics_mean([v for _, v in pts[j:i + 1]]))
    return out

def statistics_mean(v): return sum(v) / len(v)

def p95(v):
    v = sorted(v); return v[min(len(v) - 1, int(round(0.95 * (len(v) - 1))))] if v else None

def main():
    if len(sys.argv) < 2: print(__doc__); sys.exit(2)
    rows = list(csv.DictReader(open(sys.argv[1], encoding="utf-8")))
    rows = [r for r in rows if r.get("ts")]
    for r in rows: r["t"] = ts(r["ts"])
    if len(rows) < 10: print("Слишком мало замеров (<10)"); sys.exit(2)
    ncpu = f(rows[0]["ncpu"]) or 1
    results = []
    def add(name, ok, detail): results.append((name, ok, detail))

    # K1 TTFB
    ttfb = [f(r["ttfb_login_s"]) for r in rows if f(r["ttfb_login_s"]) is not None] + \
           [f(r["ttfb_health_s"]) for r in rows if f(r["ttfb_health_s"]) is not None]
    run = mx = 0
    for r in rows:
        v = f(r["ttfb_login_s"]); run = run + 1 if (v is not None and v > TTFB_SPIKE_S) else 0; mx = max(mx, run)
    pp = p95(ttfb)
    add("K1 TTFB сайта (p95 ≤ %.1f с; не 3 подряд > %.0f с)" % (TTFB_P95_MAX_S, TTFB_SPIKE_S),
        pp is not None and pp <= TTFB_P95_MAX_S and mx < TTFB_SPIKE_RUN,
        "p95=%.3f с, макс. серия >%.0fс = %d" % (pp or -1, TTFB_SPIKE_S, mx))

    # K2a CPU вне окон ASR
    idle = rolling_means(rows, "cpu_pct", pred=lambda r: (f(r["asr_cpu_pct"]) or 0) < ASR_ACTIVE_CPU)
    m = max(idle) if idle else None
    add("K2a CPU вне окон ASR (rolling-5мин < %.0f%%)" % CPU_IDLE_ASR_MAX, m is None or m < CPU_IDLE_ASR_MAX,
        "макс=%s" % ("%.1f%%" % m if m is not None else "нет подходящих окон"))
    # K2b load в окнах ASR
    for r in rows: r["_lpc"] = (f(r["load1"]) or 0) / ncpu
    act = rolling_means(rows, "_lpc", pred=lambda r: (f(r["asr_cpu_pct"]) or 0) >= ASR_ACTIVE_CPU)
    m = max(act) if act else None
    add("K2b load1/ncpu в окнах ASR (rolling-5мин ≤ %.2f)" % LOAD_PER_CPU_MAX, m is None or m <= LOAD_PER_CPU_MAX,
        "макс=%s" % ("%.2f" % m if m is not None else "нет окон ASR ≥5 мин"))
    cpus = [f(r["cpu_pct"]) for r in rows if f(r["cpu_pct"]) is not None]
    print("(справка) CPU ВМ: среднее %.1f%%, p95 %.1f%%; ASR по дизайну загружает все ядра во время транскрибации" % (statistics_mean(cpus), p95(cpus)))

    # K3 RAM / OOM
    low = 0; mxl = 0
    for r in rows:
        mt, ma = f(r["mem_total_mb"]), f(r["mem_avail_mb"])
        low = low + 1 if (mt and ma is not None and ma < MEM_AVAIL_MIN_FRAC * mt) else 0; mxl = max(mxl, low)
    oom = any(r["oom_any"] == "1" for r in rows)
    mina = min(f(r["mem_avail_mb"]) for r in rows if f(r["mem_avail_mb"]) is not None)
    add("K3 RAM (доступно ≥ %.0f%%; без OOM)" % (MEM_AVAIL_MIN_FRAC * 100), mxl < 2 and not oom,
        "мин. доступно %.0f МБ, серия низких замеров %d, OOM=%s" % (mina, mxl, oom))

    # K4 swap
    sw = [f(r["swap_used_mb"]) for r in rows if f(r["swap_used_mb"]) is not None]
    add("K4 swap (≤ %d МБ, прирост ≤ %d МБ)" % (SWAP_USED_MAX_MB, SWAP_GROWTH_MAX_MB),
        max(sw) <= SWAP_USED_MAX_MB and (sw[-1] - sw[0]) <= SWAP_GROWTH_MAX_MB, "макс=%.0f, прирост=%.0f МБ" % (max(sw), sw[-1] - sw[0]))

    # K5 рестарты
    r0, r1 = f(rows[0]["restarts_total"]) or 0, f(rows[-1]["restarts_total"]) or 0
    add("K5 рестарты контейнеров (0)", r1 <= r0, "было %d → стало %d" % (r0, r1))

    # K6 HTTP-ошибки
    codes = [r["http_login"] for r in rows] + [r["http_health"] for r in rows]
    bad = sum(1 for c in codes if c not in ("200",))
    add("K6 HTTP-ошибки на /login и /api/health (≤ %.0f%%)" % (HTTP_ERR_MAX_FRAC * 100), bad / len(codes) <= HTTP_ERR_MAX_FRAC, "%d из %d" % (bad, len(codes)))

    # K7 ASR slowdown
    if "--asr-jobs" in sys.argv:
        jobs = list(csv.DictReader(open(sys.argv[sys.argv.index("--asr-jobs") + 1], encoding="utf-8")))
        def rtf(phase):
            v = [f(j["job_sec"]) / f(j["audio_sec"]) for j in jobs if j["phase"] == phase and f(j["audio_sec"]) and f(j["job_sec"])]
            return st.median(v) if v else None
        b, l = rtf("baseline"), rtf("loaded")
        if b and l: add("K7 время ASR под нагрузкой ≤ +%.0f%% к baseline" % ((ASR_SLOWDOWN_MAX - 1) * 100), l / b <= ASR_SLOWDOWN_MAX, "RTF baseline=%.3f, loaded=%.3f, ×%.2f" % (b, l, l / b))
        else: add("K7 время ASR", False, "нет данных baseline и/или loaded")
    else:
        print("(K7 пропущен: нет --asr-jobs; без него критерий не оценён)")

    print("\nИТОГ по критериям:")
    for name, ok, d in results: print(" [%s] %s — %s" % ("PASS" if ok else "FAIL", name, d))
    failed = [n for n, ok, _ in results if not ok]
    print("\n" + ("Все проверенные критерии пройдены: текущая ВМ подходит для этой нагрузки." if not failed
          else "СРАБОТАЛИ: %d. Текущая ASR-ВМ не подходит — сравниваем апгрейд ASR-ВМ / Serverless Containers / отдельную frontend-ВМ." % len(failed)))
    sys.exit(1 if failed else 0)

if __name__ == "__main__": main()

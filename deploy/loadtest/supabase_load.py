#!/usr/bin/env python3
"""Нагрузка на self-hosted Supabase: имитация N психологов, ведущих запись сессии одновременно (пиковый случай).

Каждый виртуальный психолог: создаётся (admin API) -> входит (signInWithPassword) -> в цикле каждые 20 с / SPEED:
  2 дорожки x (подпись URL + PUT чанка ~90 КБ в бакет session-recordings), каждые 3 тика — REST-чтения с токеном пользователя (RLS).
В конце всё за собой удаляет (пользователи, файлы). Только стандартная библиотека. Ключи читаются из ~/supabase/.env, не печатаются.
Запуск на ВМ:  python3 supabase_load.py --users 20 --minutes 10 [--speed 1] [--url https://db.tolkplace.ru]
Очистка после обрыва:  python3 supabase_load.py --purge
Не моделируется: запись транскрипта и тяжёлые запросы приложения (малые по объёму); вызовы YandexGPT.
"""
import argparse, json, os, random, statistics, sys, threading, time, urllib.request, urllib.error, uuid

def load_env(path):
    env = {}
    for line in open(os.path.expanduser(path), encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); env[k] = v.strip().strip('"').strip("'")
    return env

class Stats:
    def __init__(self): self.lock = threading.Lock(); self.d = {}; self.err_samples = []; self.bytes_up = 0
    def add(self, op, sec, ok, info=""):
        with self.lock:
            self.d.setdefault(op, []).append((sec, ok))
            if not ok and len(self.err_samples) < 8: self.err_samples.append(f"{op}: {info}")

def req(method, url, headers, data=None, timeout=60):
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp: return resp.status, resp.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
    except Exception as e: return 0, str(e).encode()

def jbody(b):
    try: return json.loads(b)
    except Exception: return {}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, default=20); ap.add_argument("--minutes", type=float, default=10)
    ap.add_argument("--speed", type=float, default=1.0, help="множитель частоты чанков (1 = как в приложении, 20 с на дорожку)")
    ap.add_argument("--ramp", type=float, default=30, help="растянуть старт пользователей на N секунд")
    ap.add_argument("--chunk-kb", type=int, default=90)
    ap.add_argument("--url", default="https://db.tolkplace.ru"); ap.add_argument("--env", default="~/supabase/.env")
    ap.add_argument("--purge", action="store_true", help="удалить всех пользователей load+*@example.com и их файлы")
    a = ap.parse_args()
    env = load_env(a.env); base = a.url.rstrip("/")
    anon, svc = env["ANON_KEY"], env["SERVICE_ROLE_KEY"]
    H_SVC = {"apikey": svc, "Authorization": "Bearer " + svc, "Content-Type": "application/json"}

    def purge(prefix="load+"):
        n = 0
        for page in range(1, 50):
            code, body = req("GET", f"{base}/auth/v1/admin/users?page={page}&per_page=200", H_SVC)
            users = jbody(body).get("users", []) if code == 200 else []
            if not users: break
            for u in users:
                if str(u.get("email", "")).startswith(prefix):
                    req("DELETE", f"{base}/auth/v1/admin/users/{u['id']}", H_SVC); n += 1
        # файлы load/ в бакете
        for _ in range(200):
            code, body = req("POST", f"{base}/storage/v1/object/list/session-recordings", H_SVC,
                             json.dumps({"prefix": "load", "limit": 1000}).encode())
            items = jbody(body) if code == 200 else []
            if not items or not isinstance(items, list): break
            # list вернёт «папки» первого уровня; удаляем рекурсивно по префиксам
            for it in items:
                sub = f"load/{it['name']}"
                _purge_prefix(sub)
            break
        print(f"purge: удалено пользователей {n}")

    def _purge_prefix(prefix):
        code, body = req("POST", f"{base}/storage/v1/object/list/session-recordings", H_SVC,
                         json.dumps({"prefix": prefix, "limit": 1000}).encode())
        items = jbody(body) if code == 200 else []
        files = []
        for it in items if isinstance(items, list) else []:
            if it.get("id"): files.append(f"{prefix}/{it['name']}")
            else: _purge_prefix(f"{prefix}/{it['name']}")
        for i in range(0, len(files), 100):
            req("DELETE", f"{base}/storage/v1/object/session-recordings", H_SVC, json.dumps({"prefixes": files[i:i+100]}).encode())

    if a.purge: purge(); return

    run = uuid.uuid4().hex[:6]; st = Stats(); chunk = os.urandom(a.chunk_kb * 1024)
    t_start = time.time(); t_end = t_start + a.minutes * 60; interval = 20.0 / a.speed
    users = []; ulock = threading.Lock()
    print(f"Нагрузка: {a.users} психологов, {a.minutes} мин, чанк каждые {interval:.1f} с на дорожку, run={run}, {base}")

    def timed(op, method, url, headers, data=None, retries=0):
        for attempt in range(retries + 1):
            t0 = time.time(); code, body = req(method, url, headers, data); dt = time.time() - t0
            ok = 200 <= code < 300
            if code == 429 and attempt < retries: time.sleep(5 + 5 * attempt); st.add(op + "_429", dt, True); continue
            st.add(op, dt, ok, f"HTTP {code} {body[:120]!r}")
            return code, body
        return code, body

    def vuser(i):
        time.sleep(a.ramp * i / max(1, a.users))
        email, pw = f"load+{run}-{i}@example.com", "Ld-" + uuid.uuid4().hex
        code, body = timed("admin_create", "POST", f"{base}/auth/v1/admin/users", H_SVC,
                           json.dumps({"email": email, "password": pw, "email_confirm": True}).encode())
        uid = jbody(body).get("id")
        if not uid: return
        with ulock: users.append(uid)
        code, body = timed("login", "POST", f"{base}/auth/v1/token?grant_type=password",
                           {"apikey": anon, "Content-Type": "application/json"},
                           json.dumps({"email": email, "password": pw}).encode(), retries=5)
        tok = jbody(body).get("access_token")
        if not tok: return
        H_USER = {"apikey": anon, "Authorization": "Bearer " + tok}
        n = 0; nxt = time.time()
        while time.time() < t_end:
            for track in ("psychologist", "client"):
                path = f"load/{run}/{uid}/{track}/{n:05d}.webm"
                code, body = timed("storage_sign", "POST", f"{base}/storage/v1/object/upload/sign/session-recordings/{path}", H_SVC, b"{}")
                url = jbody(body).get("url")
                if url:
                    timed("storage_put", "PUT", f"{base}/storage/v1{url}", {"Content-Type": "audio/webm"}, chunk)
                    with st.lock: st.bytes_up += len(chunk)
            if n % 3 == 0:
                timed("rest_own_profile", "GET", f"{base}/rest/v1/psychologists?select=*&id=eq.{uid}", H_USER)
                timed("rest_list_clients", "GET", f"{base}/rest/v1/clients?select=id&limit=20", H_USER)
            n += 1; nxt += interval
            time.sleep(max(0, nxt - time.time()))

    th = [threading.Thread(target=vuser, args=(i,), daemon=True) for i in range(a.users)]
    [t.start() for t in th]
    try:
        while any(t.is_alive() for t in th):
            time.sleep(15); sys.stdout.write(f"\r  прошло {time.time()-t_start:5.0f} с, запросов {sum(len(v) for v in st.d.values())}   "); sys.stdout.flush()
    except KeyboardInterrupt:
        print("\nпрервано, убираю за собой")
    print()
    dur = time.time() - t_start
    print(f"{'операция':<20}{'всего':>7}{'ошибок':>8}{'p50, с':>9}{'p95, с':>9}{'p99, с':>9}{'max, с':>9}")
    total = errs = 0
    for op, v in sorted(st.d.items()):
        ts = sorted(x[0] for x in v); e = sum(1 for x in v if not x[1]); total += len(v); errs += e
        q = lambda p: ts[min(len(ts) - 1, int(p * (len(ts) - 1)))]
        print(f"{op:<20}{len(v):>7}{e:>8}{q(0.5):>9.3f}{q(0.95):>9.3f}{q(0.99):>9.3f}{ts[-1]:>9.3f}")
    print(f"Итого: {total} запросов за {dur:.0f} с ({total/dur:.1f}/с), ошибок {errs} ({100*errs/max(1,total):.2f}%), загружено {st.bytes_up/1e6:.0f} МБ ({st.bytes_up/1e6/dur:.2f} МБ/с)")
    for s in st.err_samples: print("  пример ошибки:", s)
    print("Очистка тестовых данных...")
    for u in users: req("DELETE", f"{base}/auth/v1/admin/users/{u}", H_SVC)
    _purge_prefix(f"load/{run}")
    print("Готово.")
    sys.exit(1 if errs / max(1, total) > 0.01 else 0)

if __name__ == "__main__":
    main()

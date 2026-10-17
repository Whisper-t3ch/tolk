#!/usr/bin/env python3
"""Копирование объектов Storage из облачного Supabase в локальный стек через Storage API.
Облако только читается. Идемпотентно: объект с тем же sha256 в локальном хранилище пропускается.
После загрузки каждый объект скачивается обратно из локального хранилища и сверяется по sha256.

Запуск НА core из ~/supabase:
  ./migrate_storage.py                 # все бакеты облака
  ./migrate_storage.py --bucket session-recordings
  ./migrate_storage.py --list          # только посчитать, ничего не копировать
Ключи: локальный service role берётся из .env; облачные URL и service role key спрашиваются (ввод скрытый)
или берутся из переменных окружения CLOUD_URL, CLOUD_SERVICE_KEY. Ключи не печатаются.
"""
import argparse, getpass, hashlib, json, os, sys, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CLOUD_URL = "https://gprmbaiacvchtovzpeqa.supabase.co"


def load_env(path):
    env = {}
    try:
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k] = v.strip().strip('"')
    except FileNotFoundError:
        pass
    return env


def req(method, url, key, data=None, headers=None, timeout=120):
    h = {"Authorization": "Bearer " + key, "apikey": key}
    if headers:
        h.update(headers)
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, resp.read(), resp.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def list_objects(base, key, bucket, prefix=""):
    """Рекурсивно: элементы без id - это «папки»."""
    out, offset = [], 0
    while True:
        body = json.dumps({"prefix": prefix, "limit": 100, "offset": offset,
                           "sortBy": {"column": "name", "order": "asc"}}).encode()
        st, b, _ = req("POST", f"{base}/storage/v1/object/list/{urllib.parse.quote(bucket)}", key, body,
                       {"Content-Type": "application/json"})
        if st != 200:
            sys.exit(f"Не удалось получить список {bucket}/{prefix}: HTTP {st} {b[:200]!r}")
        items = json.loads(b)
        for it in items:
            path = f"{prefix}/{it['name']}" if prefix else it["name"]
            if it.get("id") is None:
                out += list_objects(base, key, bucket, path)
            else:
                out.append((path, it.get("metadata") or {}))
        if len(items) < 100:
            break
        offset += 100
    return out


def obj_url(base, bucket, path):
    return f"{base}/storage/v1/object/{urllib.parse.quote(bucket)}/{urllib.parse.quote(path)}"


def get_object(base, key, bucket, path):
    st, b, _ = req("GET", obj_url(base, bucket, path), key)
    return (b if st == 200 else None), st


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", help="только этот бакет")
    ap.add_argument("--list", action="store_true", help="только посчитать объекты")
    args = ap.parse_args()

    env = load_env(os.path.join(HERE, ".env"))
    local_key = env.get("SERVICE_ROLE_KEY") or sys.exit("Нет SERVICE_ROLE_KEY в .env")
    local = f"http://{env.get('API_GW_BIND', '172.17.0.1')}:{env.get('API_GW_HTTP_PORT', '8000')}"
    cloud = os.environ.get("CLOUD_URL") or input(f"URL облачного проекта [{DEFAULT_CLOUD_URL}]: ").strip() or DEFAULT_CLOUD_URL
    cloud_key = os.environ.get("CLOUD_SERVICE_KEY") or getpass.getpass("Облачный service role key (ввод скрытый): ").strip()
    cloud = cloud.rstrip("/")
    if not cloud_key:
        sys.exit("Пустой ключ")

    st, b, _ = req("GET", f"{cloud}/storage/v1/bucket", cloud_key)
    if st != 200:
        sys.exit(f"Облако: список бакетов HTTP {st} {b[:200]!r}")
    cloud_buckets = {x["id"]: x for x in json.loads(b)}
    st, b, _ = req("GET", f"{local}/storage/v1/bucket", local_key)
    if st != 200:
        sys.exit(f"Локально: список бакетов HTTP {st} {b[:200]!r}")
    local_buckets = {x["id"] for x in json.loads(b)}

    names = [args.bucket] if args.bucket else sorted(cloud_buckets)
    total = copied = skipped = failed = 0
    total_bytes = 0
    for name in names:
        if name not in cloud_buckets:
            print(f"{name}: нет в облаке, пропуск")
            continue
        objs = list_objects(cloud, cloud_key, name)
        size = sum(int(m.get("size", 0) or 0) for _, m in objs)
        print(f"{name}: {len(objs)} объектов, {size / 1e6:.1f} МБ")
        total += len(objs)
        total_bytes += size
        if args.list:
            continue
        if name not in local_buckets:
            bx = cloud_buckets[name]
            body = json.dumps({"id": name, "name": name, "public": bool(bx.get("public")),
                               "file_size_limit": bx.get("file_size_limit"),
                               "allowed_mime_types": bx.get("allowed_mime_types")}).encode()
            st, b, _ = req("POST", f"{local}/storage/v1/bucket", local_key, body, {"Content-Type": "application/json"})
            if st not in (200, 201):
                print(f"  не удалось создать бакет {name}: HTTP {st} {b[:200]!r}")
                failed += len(objs)
                continue
            print(f"  бакет {name} создан локально")
        for path, meta in objs:
            data, st = get_object(cloud, cloud_key, name, path)
            if data is None:
                print(f"  ОШИБКА чтения из облака: {path} (HTTP {st})")
                failed += 1
                continue
            sha = hashlib.sha256(data).hexdigest()
            existing, _ = get_object(local, local_key, name, path)
            if existing is not None and hashlib.sha256(existing).hexdigest() == sha:
                skipped += 1
                continue
            mime = meta.get("mimetype") or "application/octet-stream"
            st, b, _ = req("POST", obj_url(local, name, path), local_key, data,
                           {"Content-Type": mime, "x-upsert": "true", "cache-control": "max-age=3600"})
            if st not in (200, 201):
                print(f"  ОШИБКА загрузки {path}: HTTP {st} {b[:200]!r}")
                failed += 1
                continue
            back, _ = get_object(local, local_key, name, path)
            if back is None or hashlib.sha256(back).hexdigest() != sha:
                print(f"  ОШИБКА сверки sha256: {path}")
                failed += 1
                continue
            copied += 1
    print(f"Итого объектов в облаке: {total} ({total_bytes / 1e6:.1f} МБ)")
    if not args.list:
        print(f"скопировано: {copied}, уже было: {skipped}, ошибок: {failed}")
        if failed:
            sys.exit(1)
        print("OK")


if __name__ == "__main__":
    main()

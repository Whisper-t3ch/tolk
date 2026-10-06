#!/usr/bin/env bash
# Проверочный тест self-hosted Supabase: gateway, Auth (регистрация/вход), триггер профиля психолога,
# RLS, Storage (подписанная загрузка, как делает приложение), уборка за собой.
# Использование: ./smoke_test.sh [BASE_URL]   (по умолчанию адрес шлюза на docker-мосте; для проверки снаружи: https://db.tolkplace.ru)
set -uo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
set -a; . ./.env; set +a
BASE="${1:-http://${API_GW_BIND:-172.17.0.1}:${API_GW_HTTP_PORT:-8000}}"
BASE="${BASE%/}"
command -v python3 >/dev/null || { echo "нужен python3"; exit 1; }

PASS=0; FAIL=0
ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1  ($2)"; FAIL=$((FAIL+1)); }
jget() { python3 -c 'import sys,json
try:
  d=json.load(sys.stdin)
  for k in sys.argv[1].split("."):
    d=d[int(k)] if isinstance(d,list) else d.get(k)
  print("" if d is None else d)
except Exception:
  print("")' "$1"; }

EMAIL="smoke+$(date +%s)@example.com"; PASSWORD="Smoke-$(openssl rand -hex 8)"
echo "Тест против $BASE"

code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON_KEY" "$BASE/auth/v1/health")
[ "$code" = 200 ] && ok "Auth health" || bad "Auth health" "HTTP $code"

code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" "$BASE/rest/v1/psychologists?select=id&limit=1")
# корень /rest/v1/ (OpenAPI) для anon закрыт в новых версиях PostgREST/Supabase (403), поэтому проверяем реальный запрос к таблице
[ "$code" = 200 ] && ok "REST (PostgREST) отвечает" || bad "REST" "HTTP $code"

# Регистрация и вход (как делает приложение: signUp + signInWithPassword)
resp=$(curl -s -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/auth/v1/signup")
UID_=$(echo "$resp" | jget id); [ -z "$UID_" ] && UID_=$(echo "$resp" | jget user.id)
[ -n "$UID_" ] && ok "Регистрация (signUp)" || bad "Регистрация" "$resp"

tok=$(curl -s -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/auth/v1/token?grant_type=password" | jget access_token)
[ -n "$tok" ] && ok "Вход (signInWithPassword)" || bad "Вход" "нет access_token (включено подтверждение почты?)"

# Триггер on_auth_user_created -> строка в public.psychologists (читаем service_role)
row=$(curl -s -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" "$BASE/rest/v1/psychologists?id=eq.$UID_&select=id,email")
[ "$(echo "$row" | jget 0.id)" = "$UID_" ] && ok "Триггер: профиль психолога создан" || bad "Триггер профиля" "$row"

# RLS: пользователь видит только свою строку
if [ -n "$tok" ]; then
  own=$(curl -s -H "apikey: $ANON_KEY" -H "Authorization: Bearer $tok" "$BASE/rest/v1/psychologists?select=id")
  n=$(echo "$own" | python3 -c 'import sys,json
try: print(len(json.load(sys.stdin)))
except Exception: print(-1)')
  [ "$n" = 1 ] && ok "RLS: пользователь видит только свой профиль" || bad "RLS" "строк: $n"
fi

# Анонимный пользователь не должен читать психологов
anon=$(curl -s -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" "$BASE/rest/v1/psychologists?select=id")
if [ "$anon" = "[]" ] || echo "$anon" | grep -q '42501'; then ok "RLS: аноним не читает psychologists"; else bad "RLS аноним" "$anon"; fi

# Storage: подписанная загрузка чанка (service_role выдаёт URL, браузер грузит по токену)
OBJ="smoke/$UID_/chunk.webm"
signed=$(curl -s -X POST -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d '{}' "$BASE/storage/v1/object/upload/sign/session-recordings/$OBJ")
url=$(echo "$signed" | jget url)
if [ -n "$url" ]; then
  head -c 90000 /dev/urandom > /tmp/smoke_chunk.bin
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "Content-Type: audio/webm" --data-binary @/tmp/smoke_chunk.bin "$BASE/storage/v1$url")
  [ "$code" = 200 ] && ok "Storage: подписанная загрузка 90 КБ" || bad "Storage upload" "HTTP $code"
  size=$(curl -s -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" "$BASE/storage/v1/object/session-recordings/$OBJ" | wc -c)
  [ "$size" = 90000 ] && ok "Storage: скачивание, размер совпал" || bad "Storage download" "размер $size"
  curl -s -o /dev/null -X DELETE -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" "$BASE/storage/v1/object/session-recordings/$OBJ"
  rm -f /tmp/smoke_chunk.bin
else
  bad "Storage sign" "$signed"
fi

# Уборка
[ -n "$UID_" ] && curl -s -o /dev/null -X DELETE -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" "$BASE/auth/v1/admin/users/$UID_"

echo "Итого: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ]

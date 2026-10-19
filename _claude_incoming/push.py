import os, sys, json, base64, urllib.request, urllib.error

TOKEN = os.environ["GH_TOKEN"]
OWNER = "Whisper-t3ch"
REPO = "tolk"
BRANCH = "main"
API = f"https://api.github.com/repos/{OWNER}/{REPO}"

def call(method, url, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        print(f"HTTP {e.code} on {method} {url}\n{body}", file=sys.stderr)
        raise

def blob_for(path):
    with open(path, "rb") as f:
        content = f.read()
    b64 = base64.b64encode(content).decode("ascii")
    res = call("POST", f"{API}/git/blobs", {"content": b64, "encoding": "base64"})
    return res["sha"]

AUTHOR = {"name": "Anton", "email": "alejnikovanton182@gmail.com"}
COMMITTER = {"name": "Артем", "email": "goldwors@gmail.com"}

ref = call("GET", f"{API}/git/refs/heads/{BRANCH}")
base_commit_sha = ref["object"]["sha"]
base_commit = call("GET", f"{API}/git/commits/{base_commit_sha}")
base_tree_sha = base_commit["tree"]["sha"]
print("base commit:", base_commit_sha)

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "files")

commit1_files = [
    "outputs/backend/migration_036_browser_recording.sql",
    "outputs/tests/recording_browser_check.mjs",
    "src/lib/recording/checksum.ts",
    "src/lib/recording/mime.ts",
    "src/lib/recording/preflight.ts",
    "src/lib/recording/sessionRecorder.ts",
    "src/lib/recording/trackRecorder.ts",
    "src/lib/recording/types.ts",
]

commit1_msg = """Браузерная запись двух аудиодорожек: ядро, preflight, схема (22.09)

Переход с серверной записи (Jibri) на запись в браузере психолога:
локальный микрофон и удалённая дорожка клиента пишутся раздельно,
на устройстве клиента не запускается ничего.

Причина замены — cross-origin: Jitsi встроен обычным iframe на чужом
домене, и MediaStream дорожки клиента снаружи недоступен. Отсюда же
решение перейти на lib-jitsi-meet со своим UI звонка (отдельная задача).

Ядро не зависит от Jitsi — принимает готовые MediaStream, поэтому
проверяется без видеосервера: outputs/tests/recording_browser_check.mjs
гоняет его в реальном Chromium на синтетических потоках (29 проверок).

migration_036 прогнана на PostgreSQL 16 поверх реконструированной схемы
(12 проверок: идемпотентность, RLS, отбой дублей, каскады). Попутно
выяснилось, что CREATE POLICY не имеет формы IF NOT EXISTS — без
drop policy if exists миграция падает на повторном прогоне. В 036
исправлено; в migration_034 та же проблема осталась.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hktyf3hQNowNVtERF9joWD"""

commit1_author_date = "2026-09-22T16:30:19+06:00"

tree1_entries = []
for path in commit1_files:
    sha = blob_for(os.path.join(root, path))
    tree1_entries.append({"path": path, "mode": "100644", "type": "blob", "sha": sha})

tree1 = call("POST", f"{API}/git/trees", {"base_tree": base_tree_sha, "tree": tree1_entries})
commit1 = call("POST", f"{API}/git/commits", {
    "message": commit1_msg,
    "tree": tree1["sha"],
    "parents": [base_commit_sha],
    "author": {**AUTHOR, "date": commit1_author_date},
    "committer": {**COMMITTER, "date": commit1_author_date},
})
print("commit1:", commit1["sha"])

upd1 = call("PATCH", f"{API}/git/refs/heads/{BRANCH}", {"sha": commit1["sha"], "force": False})
print("ref updated to commit1:", upd1["object"]["sha"])

commit2_msg = """Добавить CLAUDE_CONTEXT_HANDOFF.md в репозиторий (22.09)

Раньше файл существовал только как документ claude.ai Project — в самом
репозитории на этом пути ничего не было (git ls-files подтверждает: до
этого коммита файла не было). Любая сессия, которая просто клонирует
репозиторий без привязки к тому же Project, не видела контекст вообще.

Также фиксирует находку по git-доступу облачных сессий: push блокируется
policy-proxy по authorized repository set, который не меняется ни личным
PAT, ни account-level GitHub-коннектором, добавленным постфактум — только
явным выбором репозитория при создании сессии/задачи.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hktyf3hQNowNVtERF9joWD"""

commit2_author_date = "2026-09-22T17:48:37+06:00"

sha2 = blob_for(os.path.join(root, "CLAUDE_CONTEXT_HANDOFF.md"))
tree2_entries = [{"path": "CLAUDE_CONTEXT_HANDOFF.md", "mode": "100644", "type": "blob", "sha": sha2}]
tree2 = call("POST", f"{API}/git/trees", {"base_tree": tree1["sha"], "tree": tree2_entries})
commit2 = call("POST", f"{API}/git/commits", {
    "message": commit2_msg,
    "tree": tree2["sha"],
    "parents": [commit1["sha"]],
    "author": {**AUTHOR, "date": commit2_author_date},
    "committer": {**COMMITTER, "date": commit2_author_date},
})
print("commit2:", commit2["sha"])

upd2 = call("PATCH", f"{API}/git/refs/heads/{BRANCH}", {"sha": commit2["sha"], "force": False})
print("ref updated to commit2:", upd2["object"]["sha"])
print("DONE")

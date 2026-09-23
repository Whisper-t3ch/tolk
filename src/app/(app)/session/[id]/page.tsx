"use client";
import { useState, useEffect, useRef, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PhoneOff, Clock, AlertTriangle } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";
import JitsiCallView, { type JitsiCallViewHandle } from "@/components/JitsiCallView";
import { buildJitsiRoomName } from "@/lib/jitsi";

// ============================================================
// Страница видеозвонка.
//
// 23.09: iframe на чужом домене (Jitsi Meet iframe API) заменён на
// JitsiCallView — собственный UI звонка поверх lib-jitsi-meet
// (src/lib/jitsi/connection.ts). Причина: same-origin policy не
// давала получить MediaStream дорожки клиента изнутри iframe, поэтому
// SessionRecorder (src/lib/recording/, написан и протестирован на
// синтетических потоках ещё 22.09) был нечем кормить. JitsiCallView
// сам поднимает звонок, преflight и запись — эта страница только
// передаёт ему roomName/sessionId и держит таймер + заметки.
//
// 23.09 (Этап 2): перед уходом со страницы обязательно дожидаемся
// callViewRef.current.finishRecording() — это останавливает recorder,
// дожидается выгрузки отставших фрагментов и отправляет manifest на
// backend (/api/sessions/[id]/recording/*, см.
// claude/browser-recording-architecture-spec.md в проекте). Раньше
// handleEnd() сразу сохранял заметки и уходил на /soap, не дожидаясь
// записи вообще — теперь без этого шага последние фрагменты консультации
// рисковали остаться невыгруженными (компонент размонтируется вместе с
// навигацией, а unmount-cleanup в JitsiCallView — best-effort, без
// ожидания сети).
//
// - id в URL — это session_id, данные грузятся через уже
//   существующий GET /api/sessions/[id]/soap (там же лежит videoRoomUrl,
//   он больше не используется для отображения звонка, но поле в ответе
//   API оставлено как есть — не трогаем контракт без необходимости).
// - Заметки сохраняются в soap_notes.s_subjective через уже
//   существующий PUT /api/sessions/[id]/soap (autosave с debounce).
// - Собственной ВМ с Jitsi-инфраструктурой пока нет — JitsiCallView
//   по умолчанию подключается к публичному meet.jit.si (см.
//   src/lib/jitsi/config.ts) и показывает предупреждение об этом.
//   Когда ВМ появится — NEXT_PUBLIC_JITSI_DOMAIN переключит и звонок,
//   и запись на неё без изменений в этом файле.
// ============================================================

interface SessionSoapData {
  session: {
    id: string;
    scheduledAt: string;
    durationMinutes: number;
    clientId: string;
    clientName: string;
    status: string;
    videoRoomUrl: string;
  };
  soapNote: { s: string } | null;
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: sessionId } = use(params);

  const [data, setData] = useState<SessionSoapData["session"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [callConnected, setCallConnected] = useState(false);
  const [notes, setNotes] = useState("");
  const [ending, setEnding] = useState(false);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callViewRef = useRef<JitsiCallViewHandle>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}/soap`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error("Не удалось загрузить сессию"))))
      .then((json: SessionSoapData) => {
        if (cancelled) return;
        setData(json.session);
        setNotes(json.soapNote?.s ?? "");
      })
      .catch(e => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Не удалось загрузить сессию");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Таймер запускается только когда звонок реально поднялся
  // (JitsiCallView.onConnected), а не с момента открытия страницы —
  // иначе он тикал бы даже пока идёт preflight/подключение к комнате.
  useEffect(() => {
    if (!callConnected) return;
    const interval = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [callConnected]);

  const saveNotes = useCallback(async (text: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}/soap`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s: text }),
      });
    } catch {
      // Тихий fallback — заметки остаются в поле ввода, следующий
      // debounce-тик или явное завершение сессии попробует снова.
    }
  }, [sessionId]);

  // Autosave заметок с debounce 1.5с — раньше notes был чистым useState
  // без всякого сохранения и терялся при уходе со страницы.
  function handleNotesChange(value: string) {
    setNotes(value);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveNotes(value), 1500);
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  async function handleEnd() {
    setEnding(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    // Запись — до заметок: заметки можно досохранить и позже, а
    // manifest должен уйти именно сейчас, пока компонент ещё
    // смонтирован (после router.push JitsiCallView размонтируется и
    // отправлять manifest будет уже не из чего). Ошибки записи не
    // должны блокировать завершение консультации для психолога —
    // finishRecording() сама не бросает исключений при сбое сети
    // (см. ChunkUploader.sendManifest), но на всякий случай всё равно
    // оборачиваем в try/catch.
    try {
      await callViewRef.current?.finishRecording();
    } catch {
      // Не блокируем завершение сессии из-за сбоя в записи — психолог
      // не должен застрять на экране звонка из-за проблем с выгрузкой.
    }
    await saveNotes(notesRef.current);
    setTimeout(() => router.push(`/session/${sessionId}/soap`), 600);
  }

  if (loading) {
    return (
      <div style={{ display: "flex", height: "calc(100vh - 120px)", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#8C7355", fontSize: 14 }}>Загружаю сессию...</p>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div style={{ display: "flex", height: "calc(100vh - 120px)", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <AlertTriangle size={32} style={{ color: "#EF4444", marginBottom: 12 }} />
          <p style={{ color: "#6B6058", fontSize: 14 }}>{loadError ?? "Сессия не найдена"}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "calc(100vh - 120px)", gap: 16, padding: "0 24px 24px" }}>
      {/* Видео */}
      <div style={{ flex: "0 0 60%" }}>
        <Card className="h-full flex flex-col">
          <div style={{
            flex: 1,
            display: "flex", flexDirection: "column",
            position: "relative",
            borderRadius: "8px 8px 0 0",
            overflow: "hidden",
          }}>
            {/* Таймер */}
            <div style={{ position: "absolute", top: 16, right: 16, display: "flex", alignItems: "center", gap: 6, background: "rgba(0,0,0,0.5)", padding: "8px 12px", borderRadius: 8, zIndex: 4 }}>
              <Clock size={16} color="#fff" />
              <span style={{ color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: "monospace" }}>
                {formatTime(seconds)}
              </span>
            </div>

            <JitsiCallView
              ref={callViewRef}
              sessionId={sessionId}
              roomName={buildJitsiRoomName(sessionId)}
              clientName={data.clientName}
              onConnected={() => setCallConnected(true)}
            />
          </div>

          {/* Контролы mic/cam — внутри JitsiCallView; здесь остаётся
              только явное завершение сессии. */}
          <CardContent className="pb-4 pt-4">
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <Button
                onClick={handleEnd}
                variant="danger"
                size="lg"
                disabled={ending}
                className="rounded-full w-14 h-14 flex items-center justify-center p-0"
              >
                <PhoneOff size={20} />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Заметки */}
      <div style={{ flex: "0 0 40%" }}>
        <Card className="h-full flex flex-col">
          <CardContent className="flex-1 pt-6 flex flex-col" style={{ minHeight: 0 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E", marginBottom: 12 }}>
              Заметки сессии
            </h3>
            <textarea
              value={notes}
              onChange={e => handleNotesChange(e.target.value)}
              placeholder="Ключевые моменты сессии..."
              style={{
                flex: 1,
                padding: "12px 14px",
                border: "1px solid #E5DFD5",
                borderRadius: 8,
                fontSize: 13,
                color: "#1C1C1E",
                fontFamily: "var(--font-sans)",
                resize: "none",
                minHeight: 0,
              }}
            />
            <div style={{ marginTop: 12, padding: "12px", background: "#E8F2EF", borderRadius: 8, borderLeft: "4px solid #2D6A5C" }}>
              <p style={{ fontSize: 12, color: "#2D6A5C", fontWeight: 500, margin: 0 }}>
                💡 Заметки сохраняются автоматически и попадут в протокол сессии
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

"use client";
import { useState, useEffect, useRef, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PhoneOff, Clock, AlertTriangle } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";

// ============================================================
// Страница видеозвонка. Раньше вся видеочасть была анимированной
// подделкой (случайный таймер "клиент подключился", статичная иконка
// вместо потока, кнопки mic/cam ничего не переключали) поверх mock
// clients — не реальной сессии из БД. Теперь:
// - id в URL — это session_id (раньше передавался client_id, страница
//   не могла достать конкретную сессию), данные грузятся через уже
//   существующий GET /api/sessions/[id]/soap (там же лежит videoRoomUrl).
// - Реальный Jitsi Meet через iframe (Jitsi Meet External API не
//   обязателен для MVP — обычный iframe с параметрами конфигурации
//   в query string работает и покрывает mic/cam toggle/leave через
//   встроенный тулбар Jitsi, что снимает необходимость дублировать
//   эти контролы в нашем UI).
// - Заметки сохраняются в soap_notes.s_subjective через уже
//   существующий PUT /api/sessions/[id]/soap (autosave с debounce),
//   а не теряются при уходе со страницы.
// - Если NEXT_PUBLIC_JITSI_DOMAIN ещё не настроен (ВМ не подключена),
//   videoRoomUrl пустой — показываем понятный экран вместо мёртвого iframe.
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
  const [notes, setNotes] = useState("");
  const [ending, setEnding] = useState(false);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    const interval = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

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

  const jitsiReady = Boolean(data.videoRoomUrl);

  return (
    <div style={{ display: "flex", height: "calc(100vh - 120px)", gap: 16, padding: "0 24px 24px" }}>
      {/* Видео */}
      <div style={{ flex: "0 0 60%" }}>
        <Card className="h-full flex flex-col">
          <div style={{
            flex: 1,
            background: "#1a2240",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            position: "relative",
            borderRadius: "8px 8px 0 0",
            overflow: "hidden",
          }}>
            {/* Таймер */}
            <div style={{ position: "absolute", top: 16, right: 16, display: "flex", alignItems: "center", gap: 6, background: "rgba(0,0,0,0.5)", padding: "8px 12px", borderRadius: 8, zIndex: 2 }}>
              <Clock size={16} color="#fff" />
              <span style={{ color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: "monospace" }}>
                {formatTime(seconds)}
              </span>
            </div>

            {jitsiReady ? (
              <iframe
                src={data.videoRoomUrl}
                allow="camera; microphone; fullscreen; display-capture; autoplay"
                style={{ width: "100%", height: "100%", border: "none" }}
                title="Видеозвонок"
              />
            ) : (
              <div style={{ textAlign: "center", padding: 24 }}>
                <AlertTriangle size={40} style={{ color: "#F59E0B", marginBottom: 12 }} />
                <p style={{ color: "#fff", fontSize: 14, maxWidth: 320, margin: "0 auto" }}>
                  Видеосервер ещё не подключён. Заметки сессии сохраняются как обычно —
                  звонок можно провести вне платформы, а протокол заполнить здесь.
                </p>
              </div>
            )}

            {/* Информация о клиенте */}
            <div style={{ position: "absolute", bottom: 16, left: 16, background: "rgba(0,0,0,0.6)", padding: "10px 14px", borderRadius: 8, zIndex: 2 }}>
              <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{data.clientName}</div>
            </div>
          </div>

          {/* Контролы — mic/cam переключаются встроенным тулбаром Jitsi
              внутри iframe, здесь остаётся только явное завершение сессии. */}
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

"use client";
// ============================================================
// Видеозвонок психолог↔клиент через lib-jitsi-meet + браузерная
// запись двух дорожек. Заменяет прежний <iframe src={videoRoomUrl}>
// в src/app/(app)/session/[id]/page.tsx — iframe на чужом домене не
// давал доступа к MediaStream дорожки клиента (same-origin policy),
// поэтому SessionRecorder (src/lib/recording/) был нечем кормить.
// Здесь звонок — наш собственный UI поверх src/lib/jitsi/connection.ts,
// оба потока (локальный микрофон психолога, удалённая дорожка
// клиента) доступны напрямую.
//
// Поток управления:
//   preflight (src/lib/recording/preflight.ts)
//     → allow: сразу входим в звонок (join), без лишнего клика —
//       так же вела себя старая версия страницы (iframe появлялся
//       сам, как только videoRoomUrl был готов);
//     → red: показываем причину, блокируем консультацию — по
//       архитектуре "серверного источника аудио нет", красный
//       preflight = запись невозможна вообще, а без записи
//       консультация на этой платформе не имеет смысла (нет
//       транскрипта → нет SOAP).
//   join() → JitsiCallSession поднимает звонок → локальный аудиопоток
//     сразу идёт в SessionRecorder.start(); удалённый — в
//     attachRemoteStream(), когда клиент подключится.
//
// 23.09: подключён backend Этапа 2 (src/lib/recording/uploader.ts +
// /api/sessions/[id]/recording/*) — фрагменты реально выгружаются в
// Object Storage по мере записи, каждые ~12с уходит heartbeat, а по
// завершении родительская страница обязана вызвать finishRecording()
// (через ref) ДО навигации: это останавливает recorder, дожидается
// незавершённых выгрузок и отправляет manifest. Без явного вызова
// finishRecording() (например, если вкладка просто закрыта) manifest
// не уйдёт и сессия останется в статусе 'recording' — это тот же
// компромисс "браузер психолога — единственный источник записи", что
// описан в architecture-spec, раздел "Непреодолимое ограничение".
// ============================================================
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Mic, MicOff, Video, VideoOff, AlertTriangle, Loader2 } from "lucide-react";
import { JitsiCallSession, type CallConnectionState } from "@/lib/jitsi/connection";
import { isUsingPublicTestServer } from "@/lib/jitsi/config";
import { runPreflight, type PreflightResult, type PreflightVerdict } from "@/lib/recording/preflight";
import { SessionRecorder, type RecordingStatusSnapshot } from "@/lib/recording/sessionRecorder";
import { ChunkUploader } from "@/lib/recording/uploader";

interface JitsiCallViewProps {
  sessionId: string;
  roomName: string;
  clientName: string;
  /** Вызывается один раз, когда звонок реально поднялся (для таймера сессии на родительской странице). */
  onConnected?: () => void;
}

/** Императивный API для родительской страницы — см. finishRecording(). */
export interface JitsiCallViewHandle {
  /**
   * Останавливает запись, дожидается выгрузки оставшихся фрагментов
   * (с ограничением по времени — см. ChunkUploader.waitForIdle) и
   * отправляет manifest на backend. Вызывать ДО навигации со страницы
   * звонка — после unmount отправить manifest уже не из чего: сам
   * компонент к этому моменту исчезнет вместе с recorder/uploader.
   * Безопасно вызывать даже если запись не начиналась (recorder ещё
   * null) — тогда просто ничего не делает.
   */
  finishRecording: () => Promise<{ manifestSent: boolean; status?: string }>;
}

const BLOCKING_VERDICTS: PreflightVerdict[] = [
  "unsupported_browser",
  "microphone_blocked",
  "recording_broken",
  "insufficient_storage",
];

const PREFLIGHT_MESSAGES: Partial<Record<PreflightVerdict, string>> = {
  unsupported_browser: "Этот браузер не поддерживает запись звука. Откройте консультацию в Chrome или Safari последней версии.",
  microphone_blocked: "Нет доступа к микрофону. Разрешите доступ в настройках браузера и обновите страницу.",
  recording_broken: "Тестовая запись не удалась — без неё консультация не будет записана и расшифрована. Проверьте микрофон и перезагрузите страницу.",
  insufficient_storage: "Недостаточно места в браузере для буфера записи. Освободите место на устройстве или используйте другое.",
};

/** Как часто слать heartbeat, пока идёт запись — середина диапазона 10-15с из architecture-spec. */
const HEARTBEAT_INTERVAL_MS = 12_000;

type ViewState =
  | "preflight"
  | "preflight_blocked"
  | "connecting"
  | "in_call"
  | "call_failed"
  | "ended";

function JitsiCallView(
  { sessionId, roomName, clientName, onConnected }: JitsiCallViewProps,
  ref: React.Ref<JitsiCallViewHandle>
) {
  const [viewState, setViewState] = useState<ViewState>("preflight");
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [camMuted, setCamMuted] = useState(true); // видео выключено по умолчанию — платформа аудио-центричная
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatusSnapshot | null>(null);
  const [chunkStats, setChunkStats] = useState({ count: 0, bytes: 0, failed: 0 });

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<JitsiCallSession | null>(null);
  const recorderRef = useRef<SessionRecorder | null>(null);
  const uploaderRef = useRef<ChunkUploader | null>(null);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const notifiedConnectedRef = useRef(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (viewState === "in_call" && !notifiedConnectedRef.current) {
      notifiedConnectedRef.current = true;
      onConnected?.();
    }
  }, [viewState, onConnected]);

  const startRecorder = useCallback((localStream: MediaStream) => {
    if (recorderRef.current) return;

    const uploader = new ChunkUploader({
      sessionId,
      onChunkGaveUp: (chunk, error) => {
        // Фрагмент остался в IndexedDB (см. uploader.ts) — не потерян
        // физически, но не подтверждён backend'ом. Считаем в счётчике
        // ошибок, чтобы психолог видел проблему, а не только "N фрагм.".
        console.error(`Фрагмент ${chunk.role}#${chunk.sequence} не выгружен после всех попыток:`, error);
        setChunkStats(prev => ({ ...prev, failed: prev.failed + 1 }));
      },
    });
    uploaderRef.current = uploader;
    void uploader.flushPending(); // осиротевшие фрагменты прошлого монтирования этой же вкладки, если есть

    const recorder = new SessionRecorder({
      sessionId,
      localStream,
      timesliceMs: 20_000,
      onChunk: chunk => {
        setChunkStats(prev => ({ ...prev, count: prev.count + 1, bytes: prev.bytes + chunk.size }));
        uploaderRef.current?.enqueue(chunk);
      },
      onStatusChange: status => {
        if (mountedRef.current) setRecordingStatus(status);
      },
    });
    recorder.start();
    recorderRef.current = recorder;
    setRecordingStatus(recorder.getStatus());
  }, [sessionId]);

  // Heartbeat каждые ~12с, пока идёт запись — независимый от потока
  // фрагментов сигнал "recorder жив", см. комментарий в
  // /api/sessions/[id]/recording/heartbeat/route.ts.
  useEffect(() => {
    if (viewState !== "in_call") return;
    const interval = setInterval(() => {
      const recorder = recorderRef.current;
      const uploader = uploaderRef.current;
      if (recorder && uploader) {
        void uploader.sendHeartbeat(recorder.getStatus());
      }
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [viewState]);

  const joinCall = useCallback(() => {
    setViewState("connecting");
    setCallError(null);

    const session = new JitsiCallSession({
      roomName,
      withVideo: !camMuted,
      onConnectionStateChange: (state: CallConnectionState) => {
        if (!mountedRef.current) return;
        if (state === "connected") setViewState("in_call");
        if (state === "failed") setViewState("call_failed");
      },
      onError: err => {
        if (!mountedRef.current) return;
        setCallError(err.message);
        setViewState("call_failed");
      },
      onLocalAudioTrack: stream => {
        localAudioStreamRef.current = stream;
        startRecorder(stream);
      },
      onLocalVideoTrack: stream => {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      },
      onRemoteAudioTrack: (_participantId, stream) => {
        setRemoteConnected(true);
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
        recorderRef.current?.attachRemoteStream(stream);
      },
      onRemoteAudioTrackRemoved: () => {
        setRemoteConnected(false);
      },
      onRemoteVideoTrack: (_participantId, stream) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      },
      onRemoteVideoTrackRemoved: () => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      },
      onParticipantLeft: () => {
        setRemoteConnected(false);
      },
    });

    sessionRef.current = session;
    session.join().catch(err => {
      if (!mountedRef.current) return;
      setCallError(err instanceof Error ? err.message : String(err));
      setViewState("call_failed");
    });
  }, [roomName, camMuted, startRecorder]);

  useImperativeHandle(
    ref,
    () => ({
      finishRecording: async () => {
        if (finishedRef.current) return { manifestSent: false };
        finishedRef.current = true;

        const recorder = recorderRef.current;
        const uploader = uploaderRef.current;
        if (!recorder || !uploader) {
          // Запись не успела начаться (например, консультация
          // завершена прямо на preflight) — отправлять нечего.
          return { manifestSent: false };
        }

        const manifest = await recorder.stop();
        // Дожидаемся отставших фрагментов, иначе backend увидит дыру в
        // реестре только потому, что последний фрагмент ещё в пути —
        // см. комментарий у ChunkUploader.waitForIdle().
        await uploader.waitForIdle();
        const result = await uploader.sendManifest(manifest);
        return { manifestSent: result.ok, status: result.status };
      },
    }),
    []
  );

  // Preflight — один раз при монтировании. testRecordingMs короткий (500мс
  // по умолчанию в runPreflight), психолог не должен ждать заметно.
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    runPreflight({}).then(result => {
      if (cancelled) return;
      setPreflight(result);
      if (BLOCKING_VERDICTS.includes(result.verdict)) {
        setViewState("preflight_blocked");
      } else {
        joinCall();
      }
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      // Best-effort подстраховка на случай, если страница ушла в
      // unmount БЕЗ явного вызова finishRecording() (например, вкладка
      // просто закрылась) — manifest в этом случае не уйдёт (сеть на
      // выходе из вкладки ненадёжна), но хотя бы recorder не остаётся
      // висеть фоновым таймером после исчезновения компонента.
      recorderRef.current?.stop().catch(() => undefined);
      sessionRef.current?.leave().catch(() => undefined);
    };
    // joinCall сознательно не в зависимостях: preflight должен запуститься
    // ровно один раз при монтировании, а не при каждом изменении camMuted
    // внутри joinCall.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleMic() {
    const next = !micMuted;
    await sessionRef.current?.setMicMuted(next);
    setMicMuted(next);
  }

  async function toggleCam() {
    const next = !camMuted;
    await sessionRef.current?.setCameraMuted(next);
    setCamMuted(next);
  }

  const recordingLabel = describeRecordingStatus(recordingStatus, remoteConnected);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      {isUsingPublicTestServer() && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 3,
            background: "#F59E0B",
            color: "#1C1C1E",
            fontSize: 11,
            fontWeight: 600,
            textAlign: "center",
            padding: "4px 8px",
          }}
        >
          Тестовый режим — звонок идёт через публичный meet.jit.si, не собственную инфраструктуру
        </div>
      )}

      <div style={{ flex: 1, position: "relative", background: "#1a2240", overflow: "hidden" }}>
        {viewState === "preflight" && <CenteredMessage icon={<Loader2 size={32} className="animate-spin" />} text="Проверяю микрофон и запись..." />}

        {viewState === "preflight_blocked" && preflight && (
          <CenteredMessage
            icon={<AlertTriangle size={40} style={{ color: "#F59E0B" }} />}
            text={PREFLIGHT_MESSAGES[preflight.verdict] ?? "Проверка перед звонком не пройдена."}
            action={{ label: "Проверить снова", onClick: () => { setViewState("preflight"); runPreflight({}).then(r => { setPreflight(r); if (BLOCKING_VERDICTS.includes(r.verdict)) setViewState("preflight_blocked"); else joinCall(); }); } }}
          />
        )}

        {viewState === "connecting" && <CenteredMessage icon={<Loader2 size={32} className="animate-spin" />} text="Подключаюсь к звонку..." />}

        {viewState === "call_failed" && (
          <CenteredMessage
            icon={<AlertTriangle size={40} style={{ color: "#EF4444" }} />}
            text={callError ?? "Не удалось подключиться к звонку."}
            action={{ label: "Повторить", onClick: joinCall }}
          />
        )}

        {(viewState === "in_call" || viewState === "connecting") && (
          <>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", display: remoteConnected ? "block" : "none" }}
            />
            <audio ref={remoteAudioRef} autoPlay />
            {!remoteConnected && viewState === "in_call" && (
              <CenteredMessage icon={<Loader2 size={28} className="animate-spin" />} text={`Ожидаю подключения: ${clientName}`} />
            )}
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={{
                position: "absolute",
                bottom: 76,
                right: 16,
                width: 140,
                height: 100,
                objectFit: "cover",
                borderRadius: 8,
                border: "2px solid rgba(255,255,255,0.3)",
                display: camMuted ? "none" : "block",
                zIndex: 2,
              }}
            />
          </>
        )}

        {viewState === "in_call" && (
          <div
            style={{
              position: "absolute",
              top: isUsingPublicTestServer() ? 28 : 16,
              left: 16,
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(0,0,0,0.55)",
              padding: "6px 10px",
              borderRadius: 8,
              fontSize: 11,
              color: recordingLabel.color,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: recordingLabel.color }} />
            {recordingLabel.text}
            {chunkStats.count > 0 && (
              <span style={{ color: "rgba(255,255,255,0.6)" }}>
                &middot; {chunkStats.count} фрагм. &middot; {(chunkStats.bytes / 1024).toFixed(0)} КБ
                {chunkStats.failed > 0 && <> &middot; <span style={{ color: "#EF4444" }}>{chunkStats.failed} не выгружено</span></>}
              </span>
            )}
          </div>
        )}

        <div style={{ position: "absolute", bottom: 16, left: 16, background: "rgba(0,0,0,0.6)", padding: "10px 14px", borderRadius: 8, zIndex: 2 }}>
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{clientName}</div>
        </div>
      </div>

      {viewState === "in_call" && (
        <div style={{ display: "flex", gap: 12, justifyContent: "center", padding: "12px 0" }}>
          <IconToggle active={!micMuted} onClick={toggleMic} onIcon={<Mic size={18} />} offIcon={<MicOff size={18} />} />
          <IconToggle active={!camMuted} onClick={toggleCam} onIcon={<Video size={18} />} offIcon={<VideoOff size={18} />} />
        </div>
      )}
    </div>
  );
}

export default forwardRef(JitsiCallView);

function describeRecordingStatus(
  status: RecordingStatusSnapshot | null,
  remoteConnected: boolean
): { text: string; color: string } {
  if (!status) return { text: "Запись не начата", color: "#8C7355" };
  const clientTrack = status.tracks.find(t => t.role === "client");
  if (clientTrack?.state === "track_lost") return { text: "Запись клиента прервана", color: "#EF4444" };
  if (!remoteConnected) return { text: "Запись идёт — ожидание клиента", color: "#F59E0B" };
  if (status.recording) return { text: "Запись идёт", color: "#EF4444" };
  return { text: "Запись остановлена", color: "#8C7355" };
}

function CenteredMessage({
  icon,
  text,
  action,
}: {
  icon: React.ReactNode;
  text: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 24,
        gap: 12,
      }}
    >
      {icon}
      <p style={{ color: "#fff", fontSize: 14, maxWidth: 320, margin: 0 }}>{text}</p>
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 8,
            padding: "8px 16px",
            background: "#2D6A5C",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function IconToggle({
  active,
  onClick,
  onIcon,
  offIcon,
}: {
  active: boolean;
  onClick: () => void;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 44,
        height: 44,
        borderRadius: "50%",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? "#F5F3EF" : "#EF4444",
        color: active ? "#1C1C1E" : "#fff",
      }}
    >
      {active ? onIcon : offIcon}
    </button>
  );
}

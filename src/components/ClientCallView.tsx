"use client";
// ============================================================
// Видеозвонок для КЛИЕНТА на публичной странице /join/[token] —
// лёгкая версия JitsiCallView.tsx без записи: запись консультации
// ведёт только браузер психолога (см. "Непреодолимое ограничение" в
// browser-recording-architecture-spec.md), клиентской стороне нечего
// отдавать SessionRecorder/ChunkUploader, поэтому здесь их нет вообще —
// только подключение к той же Jitsi-комнате (lib-jitsi-meet,
// src/lib/jitsi/connection.ts), без preflight (preflight проверяет
// способность БРАУЗЕРА ЗАПИСЫВАТЬ звук, клиенту это не нужно).
//
// 02.10.2026: пока нет собственной ВМ, NEXT_PUBLIC_JITSI_DOMAIN
// указывает на публичный meet.jit.si — а там, по заметке в
// src/lib/jitsi/config.ts (живой тест 23.09), анонимный участник,
// заходящий в совершенно новую комнату, попадает в Lobby и не может
// пройти дальше без модератора с аккаунтом Jitsi. Поэтому РЕАЛЬНЫЙ
// двусторонний звонок через эту страницу можно довести до конца
// только на собственной ВМ (anonymous-аутентификация без Lobby) — см.
// claude/join-page-jitsi-gap-02-10.md. Код написан и готов уже сейчас,
// чтобы на момент появления ВМ не потребовалось ничего менять, кроме
// самого NEXT_PUBLIC_JITSI_DOMAIN.
//
// JWT (src/lib/jitsi/jwt.ts, issueClientJwt) сюда СОЗНАТЕЛЬНО не
// передаётся — по тому же явному ограничению, что и для психолога
// (connection.ts никогда не передаёт token в JitsiConnection.connect()):
// "подготовка, не подключение", отдельное решение только когда ВМ
// появится и Prosody переключат на authentication=token (см. комментарий
// в начале jwt.ts). Подключение здесь — анонимное, как и у психолога.
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, AlertTriangle, Loader2, Check } from "lucide-react";
import { JitsiCallSession, type CallConnectionState } from "@/lib/jitsi/connection";
import { isUsingPublicTestServer } from "@/lib/jitsi/config";
import { getFriendlyCallErrorMessage } from "@/lib/jitsi/errors";

interface ClientCallViewProps {
  roomName: string;
  /** Имя психолога — показываем клиенту, с кем он на связи (своё имя клиент никуда не вводил, он анонимен). */
  psychologistName: string;
  /** Занять всю высоту контейнера (полноэкранный звонок) вместо компактного окна 420px. */
  fill?: boolean;
}

type ViewState = "connecting" | "in_call" | "call_failed" | "ended";

/** Сколько ждём возвращения психолога после его выхода, прежде чем считать сессию завершённой. */
const PSYCHOLOGIST_LEFT_GRACE_MS = 12_000;

export default function ClientCallView({ roomName, psychologistName, fill = false }: ClientCallViewProps) {
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewState, setViewState] = useState<ViewState>("connecting");
  const [callError, setCallError] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [camMuted, setCamMuted] = useState(true); // видео выключено по умолчанию — та же конвенция, что и у психолога
  const [remoteConnected, setRemoteConnected] = useState(false);
  /** Психолог показывает экран — картинку вписываем целиком, а не обрезаем. */
  const [remoteIsScreen, setRemoteIsScreen] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<JitsiCallSession | null>(null);
  const mountedRef = useRef(true);

  const joinCall = useCallback(() => {
    setViewState("connecting");
    setCallError(null);

    const session = new JitsiCallSession({
      roomName,
      displayName: "Клиент",
      withVideo: !camMuted,
      onConnectionStateChange: (state: CallConnectionState) => {
        if (!mountedRef.current) return;
        if (state === "connected") setViewState("in_call");
        if (state === "failed") setViewState("call_failed");
      },
      onError: err => {
        if (!mountedRef.current) return;
        setCallError(getFriendlyCallErrorMessage(err));
        setViewState("call_failed");
      },
      onLocalVideoTrack: stream => {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      },
      onRemoteAudioTrack: (_participantId, stream) => {
        // Психолог вернулся (кратковременный обрыв связи) — отменяем завершение.
        if (endTimerRef.current) {
          clearTimeout(endTimerRef.current);
          endTimerRef.current = null;
        }
        setRemoteConnected(true);
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
      },
      onRemoteAudioTrackRemoved: () => {
        setRemoteConnected(false);
      },
      onRemoteVideoTrack: (_participantId, stream, videoType) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
        setRemoteIsScreen(videoType === "desktop");
      },
      onRemoteVideoTrackRemoved: (_participantId, stream) => {
        // Новая дорожка (экран вместо камеры) может прийти раньше, чем снимется старая.
        const el = remoteVideoRef.current;
        if (el && (!stream || el.srcObject === stream)) {
          el.srcObject = null;
          setRemoteIsScreen(false);
        }
      },
      onParticipantLeft: () => {
        setRemoteConnected(false);
        // Психолог вышел из комнаты. Если не вернётся за пару секунд — сессия завершена:
        // закрываем звонок и показываем клиенту понятное сообщение вместо вечного «ожидания».
        if (endTimerRef.current) clearTimeout(endTimerRef.current);
        endTimerRef.current = setTimeout(() => {
          endTimerRef.current = null;
          if (!mountedRef.current) return;
          void sessionRef.current?.leave().catch(() => undefined);
          setViewState("ended");
        }, PSYCHOLOGIST_LEFT_GRACE_MS);
      },
    });

    sessionRef.current = session;
    session.join().catch(err => {
      if (!mountedRef.current) return;
      setCallError(getFriendlyCallErrorMessage(err));
      setViewState("call_failed");
    });
  }, [roomName, camMuted]);

  useEffect(() => {
    mountedRef.current = true;
    joinCall();
    return () => {
      mountedRef.current = false;
      if (endTimerRef.current) clearTimeout(endTimerRef.current);
      sessionRef.current?.leave().catch(() => undefined);
    };
    // joinCall сознательно не в зависимостях — звонок должен начаться
    // ровно один раз при монтировании, см. тот же паттерн в JitsiCallView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleMic() {
    const next = !micMuted;
    await sessionRef.current?.setMicMuted(next);
    setMicMuted(next);
  }

  async function toggleCam() {
    const next = !camMuted;
    setCamError(null);
    try {
      const ok = await sessionRef.current?.setCameraMuted(next);
      if (ok === false) {
        setCamError("Не удалось включить камеру");
        return;
      }
      setCamMuted(next);
    } catch {
      setCamError("Нет доступа к камере: разрешите её в настройках браузера и попробуйте снова");
    }
  }

  return (
    <div style={{ position: "relative", width: "100%", height: fill ? "100%" : 420, borderRadius: fill ? 0 : 16, overflow: "hidden", background: "#1a2240" }}>
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
          Тестовый режим — звонок идёт через публичный meet.jit.si
        </div>
      )}

      <div style={{ position: "absolute", inset: 0 }}>
        {viewState === "connecting" && (
          <CenteredMessage icon={<Loader2 size={32} className="animate-spin" />} text="Подключаюсь к звонку..." />
        )}

        {viewState === "ended" && (
          <CenteredMessage
            icon={<Check size={40} style={{ color: "#6EE7B7" }} />}
            text="Сессия завершена. Спасибо! Эту страницу можно закрыть."
          />
        )}

        {viewState === "call_failed" && (
          <CenteredMessage
            icon={<AlertTriangle size={40} style={{ color: "#F87171" }} />}
            text={callError ?? "Не удалось подключиться к звонку."}
            action={{ label: "Повторить", onClick: joinCall }}
          />
        )}

        {viewState === "in_call" && (
          <>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{ width: "100%", height: "100%", objectFit: remoteIsScreen ? "contain" : "cover", background: remoteIsScreen ? "#0F0F10" : undefined, display: remoteConnected ? "block" : "none" }}
            />
            <audio ref={remoteAudioRef} autoPlay />
            {!remoteConnected && (
              <CenteredMessage icon={<Loader2 size={28} className="animate-spin" />} text={`Ожидаю подключения: ${psychologistName}`} />
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
                width: 120,
                height: 86,
                objectFit: "cover",
                borderRadius: 8,
                border: "2px solid rgba(255,255,255,0.3)",
                display: camMuted ? "none" : "block",
                transform: "scaleX(-1)", // своё превью зеркальное, как в зеркале; собеседник показывается без отражения
                zIndex: 2,
              }}
            />
            <div style={{ position: "absolute", bottom: 16, left: 16, background: "rgba(0,0,0,0.6)", padding: "8px 12px", borderRadius: 8, zIndex: 2 }}>
              <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{psychologistName}</div>
            </div>
            {camError && (
              <div style={{ position: "absolute", bottom: 72, left: 12, right: 12, zIndex: 3, background: "rgba(185,28,28,0.9)", color: "#fff", fontSize: 12, padding: "6px 10px", borderRadius: 8, textAlign: "center" }}>
                {camError}
              </div>
            )}
            <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, display: "flex", gap: 12, justifyContent: "center" }}>
              <IconToggle active={!micMuted} onClick={toggleMic} onIcon={<Mic size={18} />} offIcon={<MicOff size={18} />} />
              <IconToggle active={!camMuted} onClick={toggleCam} onIcon={<Video size={18} />} offIcon={<VideoOff size={18} />} />
            </div>
          </>
        )}
      </div>
    </div>
  );
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

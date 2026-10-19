"use client";
// ============================================================
// ВРЕМЕННАЯ тестовая страница — существует ТОЛЬКО в ветке
// test/jitsi-livecheck, в main не мерджится.
//
// Два режима проверки реального кода приложения:
//
// 1. «Подключиться» — полный путь через JitsiCallSession
//    (src/lib/jitsi/connection.ts) как в реальном звонке психолог↔
//    клиент. Требует микрофон — в изолированном браузере агента
//    getUserMedia заблокирован политикой окружения (не код продукта),
//    поэтому этот путь останавливается на acquiring_media.
//
// 2. «Подключиться без микрофона (диагностика)» — вызывает
//    loadJitsiMeetJS() и getJitsiConnectionConfig() напрямую (те же
//    модули, что и JitsiCallSession использует внутри), строит
//    JitsiConnection и слушает события сигнализации — без локальных
//    треков. Проверяет именно то, что было сломано (Strophe/бандл/
//    connectionOptions), не упираясь в недоступный в этой песочнице
//    микрофон.
// ============================================================
import { useState } from "react";
import { JitsiCallSession, type CallConnectionState } from "@/lib/jitsi/connection";
import { loadJitsiMeetJS } from "@/lib/jitsi/loadLibJitsiMeet";
import { getJitsiConnectionConfig } from "@/lib/jitsi/config";

const ROOM_NAME = "tolk-livetest-app-20260923-a41f";

export default function JitsiLiveCheckAppPage() {
  const [state, setState] = useState<CallConnectionState>("idle");
  const [log, setLog] = useState<string[]>([]);

  function addLog(msg: string) {
    setLog(prev => [...prev, `${new Date().toISOString().slice(11, 23)} ${msg}`]);
  }

  function joinWithMic() {
    addLog("[JitsiCallSession] join() — полный путь, требует микрофон");
    const session = new JitsiCallSession({
      roomName: ROOM_NAME,
      displayName: "livecheck",
      withVideo: false,
      onConnectionStateChange: s => {
        setState(s);
        addLog("[JitsiCallSession] state -> " + s);
      },
      onLocalAudioTrack: () => addLog("[JitsiCallSession] локальная аудиодорожка получена"),
      onRemoteAudioTrack: (participantId, stream) =>
        addLog(`[JitsiCallSession] remote audio от ${participantId}, tracks=${stream.getAudioTracks().length}`),
      onParticipantLeft: participantId => addLog("[JitsiCallSession] участник вышел: " + participantId),
      onError: e => addLog("[JitsiCallSession] ERROR: " + e.message),
    });
    session.join().catch(e => addLog("[JitsiCallSession] join() отклонён: " + (e instanceof Error ? e.message : String(e))));
  }

  // Диагностический путь: те же loadJitsiMeetJS()/getJitsiConnectionConfig(),
  // что использует connection.ts, но без createLocalTracks — проверяем
  // именно загрузку lib-jitsi-meet.min.js и подъём XMPP-соединения/
  // конференции.
  async function joinNoMic() {
    addLog("[raw] loadJitsiMeetJS() — реальный модуль src/lib/jitsi/loadLibJitsiMeet.ts");
    try {
      const JitsiMeetJS = await loadJitsiMeetJS();
      addLog("[raw] loadJitsiMeetJS() resolved — Strophe и JitsiMeetJS доступны");

      const { connectionOptions } = getJitsiConnectionConfig(ROOM_NAME);
      addLog("[raw] getJitsiConnectionConfig() — те же connectionOptions, что и в реальном звонке");

      const connection = new JitsiMeetJS.JitsiConnection(undefined, null, connectionOptions);
      addLog("[raw] new JitsiConnection(...) создан без ошибок (раньше именно тут падало Strophe is not defined)");

      connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, () => {
        addLog("[raw] CONNECTION_ESTABLISHED");
        const conference = connection.initJitsiConference(ROOM_NAME, { openBridgeChannel: true });
        conference.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, () => addLog("[raw] CONFERENCE_JOINED"));
        conference.on(JitsiMeetJS.events.conference.CONFERENCE_FAILED, (err: unknown) =>
          addLog("[raw] CONFERENCE_FAILED: " + String(err))
        );
        conference.on(JitsiMeetJS.events.conference.USER_JOINED, (id: string) => addLog("[raw] USER_JOINED: " + id));
        conference.on(JitsiMeetJS.events.conference.TRACK_ADDED, (track: { isLocal: () => boolean; getType: () => string }) => {
          if (track.isLocal()) return;
          addLog("[raw] TRACK_ADDED remote " + track.getType());
        });
        conference.join();
        addLog("[raw] conference.join() вызван");
      });
      connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_FAILED, (t: string, m: string) =>
        addLog("[raw] CONNECTION_FAILED: " + t + " " + (m || ""))
      );
      connection.connect({ name: ROOM_NAME });
      addLog("[raw] connection.connect() вызван");
    } catch (e) {
      addLog("[raw] исключение: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <div
      style={{
        padding: 24,
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
        background: "#0b1220",
        color: "#e7ecf5",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: 18 }}>Jitsi Live Check — реальный код приложения</h1>
      <p style={{ color: "#8a94ab", fontSize: 13 }}>
        Комната: {ROOM_NAME} · JitsiCallSession/loadJitsiMeetJS/getJitsiConnectionConfig из src/lib/jitsi/ как есть
      </p>
      <p style={{ fontSize: 14 }}>
        Состояние (JitsiCallSession): <b>{state}</b>
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={joinWithMic} style={{ padding: "8px 16px", fontSize: 14 }}>
          Подключиться
        </button>
        <button onClick={joinNoMic} style={{ padding: "8px 16px", fontSize: 14 }}>
          Подключиться без микрофона (диагностика)
        </button>
      </div>
      <pre
        style={{
          marginTop: 16,
          whiteSpace: "pre-wrap",
          fontSize: 12.5,
          lineHeight: 1.6,
          maxHeight: "60vh",
          overflowY: "auto",
          border: "1px solid #1f2c47",
          borderRadius: 8,
          padding: 12,
        }}
      >
        {log.join("\n")}
      </pre>
    </div>
  );
}

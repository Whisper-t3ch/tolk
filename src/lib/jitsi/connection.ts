// ============================================================
// Обёртка над lib-jitsi-meet для консультации психолог↔клиент.
//
// Заменяет прежний <iframe src={videoRoomUrl}> — тот не давал
// доступа к MediaStream дорожки клиента (Jitsi на чужом домене,
// same-origin policy блокирует getOriginalStream() снаружи). Эта
// обёртка получает JitsiTrack напрямую внутри нашего собственного
// клиента звонка, поэтому и local, и remote MediaStream доступны
// SessionRecorder (src/lib/recording/) — см. architecture-spec в
// проекте claude.ai.
//
// Модуль ничего не знает о рекордере — отдаёт только события и
// MediaStream/JitsiTrack через колбэки. Вызывающий код (JitsiCallView)
// сам решает, что делать с дорожками (показать видео, отдать в
// SessionRecorder). Это то же разделение ответственности, что и в
// src/lib/recording/ (recorder ничего не знает про Jitsi).
// ============================================================
import type {
  JitsiConference,
  JitsiConnection as JitsiConnectionType,
  JitsiLocalTrack,
  JitsiMeetJSStatic,
  JitsiRemoteTrack,
} from "lib-jitsi-meet";
import { loadJitsiMeetJS } from "./loadLibJitsiMeet";
import { getJitsiConnectionConfig } from "./config";

export type CallConnectionState =
  | "idle"
  | "acquiring_media"
  | "connecting"
  | "connected"
  | "failed"
  | "left";

export interface JitsiCallSessionOptions {
  roomName: string;
  displayName?: string;
  /** true — запросить и опубликовать камеру психолога, не только микрофон. */
  withVideo?: boolean;
  onLocalAudioTrack?: (stream: MediaStream, track: JitsiLocalTrack) => void;
  onLocalVideoTrack?: (stream: MediaStream, track: JitsiLocalTrack) => void;
  /** Аудиодорожка клиента появилась — именно она нужна SessionRecorder. */
  onRemoteAudioTrack?: (participantId: string, stream: MediaStream) => void;
  onRemoteAudioTrackRemoved?: (participantId: string) => void;
  onRemoteVideoTrack?: (participantId: string, stream: MediaStream) => void;
  onRemoteVideoTrackRemoved?: (participantId: string) => void;
  /** Клиент вышел из комнаты (не то же самое, что пропажа дорожки при mute). */
  onParticipantLeft?: (participantId: string) => void;
  onConnectionStateChange?: (state: CallConnectionState) => void;
  onError?: (error: Error) => void;
}

/**
 * Один звонок психолог↔клиент через lib-jitsi-meet. Жизненный цикл:
 * join() — получить локальные дорожки, поднять XMPP-соединение,
 * зайти в комнату; leave() — выйти и освободить все дорожки.
 * Экземпляр одноразовый: для повторного звонка создавать новый.
 */
export class JitsiCallSession {
  private readonly options: JitsiCallSessionOptions;
  private JitsiMeetJS: JitsiMeetJSStatic | null = null;
  private connection: JitsiConnectionType | null = null;
  private conference: JitsiConference | null = null;
  private localAudioTrack: JitsiLocalTrack | null = null;
  private localVideoTrack: JitsiLocalTrack | null = null;
  private state: CallConnectionState = "idle";
  private leaving = false;

  // Забиндены один раз в конструкторе — нужны одни и те же ссылки на
  // функции для addEventListener/removeEventListener при очистке.
  private readonly handleConnectionEstablished = () => this.onConnectionEstablished();
  private readonly handleConnectionFailed = (errType: string, msg: string) =>
    this.onConnectionFailed(errType, msg);
  private readonly handleTrackAdded = (track: JitsiLocalTrack | JitsiRemoteTrack) =>
    this.onTrackAdded(track);
  private readonly handleTrackRemoved = (track: JitsiLocalTrack | JitsiRemoteTrack) =>
    this.onTrackRemoved(track);
  private readonly handleUserLeft = (participantId: string) => this.onUserLeft(participantId);

  constructor(options: JitsiCallSessionOptions) {
    this.options = options;
  }

  getState(): CallConnectionState {
    return this.state;
  }

  /**
   * Получает локальные дорожки и поднимает звонок. Отклоняется, если
   * не удалось получить микрофон (видео — best-effort, его отсутствие
   * не должно срывать консультацию: психолог всё ещё может говорить
   * и записываться, просто без своего видео).
   *
   * ВАЖНО: preflight (src/lib/recording/preflight.ts) должен быть уже
   * пройден до вызова join() — эта функция не подменяет preflight,
   * она поднимает реальный звонок.
   */
  async join(): Promise<void> {
    this.setState("acquiring_media");

    this.JitsiMeetJS = await loadJitsiMeetJS();

    const devices: Array<"audio" | "video"> = this.options.withVideo ? ["audio", "video"] : ["audio"];
    const tracks = await this.JitsiMeetJS.createLocalTracks({ devices }).catch(async e => {
      // Если запросили audio+video и провалились вместе — пробуем
      // отдельно аудио. Камера недоступна/занята не должна блокировать
      // консультацию, микрофон обязателен.
      if (devices.length > 1) {
        return this.JitsiMeetJS!.createLocalTracks({ devices: ["audio"] });
      }
      throw e;
    });

    for (const track of tracks) {
      if (track.isAudioTrack()) {
        this.localAudioTrack = track;
        this.options.onLocalAudioTrack?.(track.getOriginalStream(), track);
      } else if (track.isVideoTrack()) {
        this.localVideoTrack = track;
        this.options.onLocalVideoTrack?.(track.getOriginalStream(), track);
      }
    }

    if (!this.localAudioTrack) {
      const error = new Error("Не удалось получить микрофон для звонка");
      this.setState("failed");
      this.options.onError?.(error);
      throw error;
    }

    this.setState("connecting");

    const { connectionOptions } = getJitsiConnectionConfig(this.options.roomName);
    this.connection = new this.JitsiMeetJS.JitsiConnection(undefined, null, connectionOptions);

    this.connection.addEventListener(
      this.JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
      this.handleConnectionEstablished
    );
    this.connection.addEventListener(
      this.JitsiMeetJS.events.connection.CONNECTION_FAILED,
      this.handleConnectionFailed
    );

    this.connection.connect({ name: this.options.roomName });
  }

  /** Выходит из комнаты, разрывает соединение, освобождает дорожки. Идемпотентен. */
  async leave(): Promise<void> {
    if (this.leaving) return;
    this.leaving = true;

    try {
      if (this.conference) {
        this.conference.off(this.JitsiMeetJS!.events.conference.TRACK_ADDED, this.handleTrackAdded);
        this.conference.off(this.JitsiMeetJS!.events.conference.TRACK_REMOVED, this.handleTrackRemoved);
        this.conference.off(this.JitsiMeetJS!.events.conference.USER_LEFT, this.handleUserLeft);
        if (this.conference.isJoined()) {
          await this.conference.leave().catch(() => undefined);
        }
      }
      if (this.connection) {
        this.connection.removeEventListener(
          this.JitsiMeetJS!.events.connection.CONNECTION_ESTABLISHED,
          this.handleConnectionEstablished
        );
        this.connection.removeEventListener(
          this.JitsiMeetJS!.events.connection.CONNECTION_FAILED,
          this.handleConnectionFailed
        );
        await Promise.resolve(this.connection.disconnect()).catch(() => undefined);
      }
      await Promise.all([
        this.localAudioTrack?.dispose().catch(() => undefined),
        this.localVideoTrack?.dispose().catch(() => undefined),
      ]);
    } finally {
      this.localAudioTrack = null;
      this.localVideoTrack = null;
      this.conference = null;
      this.connection = null;
      this.setState("left");
    }
  }

  private setState(state: CallConnectionState): void {
    this.state = state;
    this.options.onConnectionStateChange?.(state);
  }

  private onConnectionEstablished(): void {
    if (!this.JitsiMeetJS || !this.connection) return;

    this.conference = this.connection.initJitsiConference(this.options.roomName, {
      openBridgeChannel: true,
    });

    if (this.options.displayName) {
      // setDisplayName живёт на JitsiConference, но типы под него не
      // заведены (не используется больше нигде в проекте) — вызываем
      // через опциональную сигнатуру, чтобы не тянуть в .d.ts метод
      // ради одной необязательной подписи.
      (this.conference as unknown as { setDisplayName?: (name: string) => void }).setDisplayName?.(
        this.options.displayName
      );
    }

    this.conference.on(this.JitsiMeetJS.events.conference.TRACK_ADDED, this.handleTrackAdded);
    this.conference.on(this.JitsiMeetJS.events.conference.TRACK_REMOVED, this.handleTrackRemoved);
    this.conference.on(this.JitsiMeetJS.events.conference.USER_LEFT, this.handleUserLeft);

    if (this.localAudioTrack) {
      void this.conference.addTrack(this.localAudioTrack);
    }
    if (this.localVideoTrack) {
      void this.conference.addTrack(this.localVideoTrack);
    }

    this.conference.join();
    this.setState("connected");
  }

  private onConnectionFailed(errType: string, msg: string): void {
    this.setState("failed");
    this.options.onError?.(new Error(`Jitsi connection failed: ${errType} ${msg ?? ""}`.trim()));
  }

  private onTrackAdded(track: JitsiLocalTrack | JitsiRemoteTrack): void {
    if (track.isLocal()) return; // свои дорожки уже обработаны в join()

    const remoteTrack = track as JitsiRemoteTrack;
    const participantId = remoteTrack.getParticipantId();
    const stream = remoteTrack.getOriginalStream();

    if (remoteTrack.isAudioTrack()) {
      this.options.onRemoteAudioTrack?.(participantId, stream);
    } else if (remoteTrack.isVideoTrack()) {
      this.options.onRemoteVideoTrack?.(participantId, stream);
    }
  }

  private onTrackRemoved(track: JitsiLocalTrack | JitsiRemoteTrack): void {
    if (track.isLocal()) return;

    const remoteTrack = track as JitsiRemoteTrack;
    const participantId = remoteTrack.getParticipantId();

    if (remoteTrack.isAudioTrack()) {
      this.options.onRemoteAudioTrackRemoved?.(participantId);
    } else if (remoteTrack.isVideoTrack()) {
      this.options.onRemoteVideoTrackRemoved?.(participantId);
    }
  }

  private onUserLeft(participantId: string): void {
    this.options.onParticipantLeft?.(participantId);
  }

  async setMicMuted(muted: boolean): Promise<void> {
    if (!this.localAudioTrack) return;
    await (muted ? this.localAudioTrack.mute() : this.localAudioTrack.unmute());
  }

  async setCameraMuted(muted: boolean): Promise<void> {
    if (!this.localVideoTrack) return;
    await (muted ? this.localVideoTrack.mute() : this.localVideoTrack.unmute());
  }

  isMicMuted(): boolean {
    return this.localAudioTrack?.isMuted() ?? true;
  }

  isCameraMuted(): boolean {
    return this.localVideoTrack?.isMuted() ?? true;
  }
}

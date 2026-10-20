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
  /** videoType: "camera" | "desktop" (демонстрация экрана) — по нему интерфейс выбирает, как вписывать картинку. */
  onRemoteVideoTrack?: (participantId: string, stream: MediaStream, videoType?: string) => void;
  /** stream — поток снятой дорожки: при замене камеры на экран новая дорожка может прийти раньше, чем снимется старая. */
  onRemoteVideoTrackRemoved?: (participantId: string, stream?: MediaStream) => void;
  /** Демонстрация экрана остановилась не по нашей кнопке (например, нативная кнопка «Прекратить показ» в браузере). */
  onScreenShareEnded?: () => void;
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
  /** Активная демонстрация экрана. Пока она идёт, в конференции вместо камеры публикуется эта дорожка. */
  private screenTrack: JitsiLocalTrack | null = null;
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
    const tracks = await this.JitsiMeetJS.createLocalTracks({ devices, ...(this.options.withVideo ? { resolution: "720" } : {}) }).catch(async e => {
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
        this.screenTrack?.dispose().catch(() => undefined),
      ]);
    } finally {
      this.localAudioTrack = null;
      this.localVideoTrack = null;
      this.screenTrack = null;
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

    // Без явных ограничений получателя мост шлёт видео собеседника в минимальном разрешении
    // («пиксели»): лист ограничений по умолчанию рассчитан на полноценный Jitsi UI, который сам
    // выбирает «говорящего». У нас один собеседник, поэтому просим до 720p.
    try {
      this.conference.setReceiverConstraints({ lastN: -1, defaultConstraints: { maxHeight: 720 } });
    } catch {
      // старые версии lib-jitsi-meet могут не знать этот вызов — качество останется по умолчанию
    }
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
    console.info("[tolk-call] удалённая дорожка добавлена:", remoteTrack.getType(), remoteTrack.videoType ?? "-", participantId);

    if (remoteTrack.isAudioTrack()) {
      this.options.onRemoteAudioTrack?.(participantId, stream);
    } else if (remoteTrack.isVideoTrack()) {
      this.options.onRemoteVideoTrack?.(participantId, stream, remoteTrack.videoType);
    }
  }

  private onTrackRemoved(track: JitsiLocalTrack | JitsiRemoteTrack): void {
    if (track.isLocal()) return;

    const remoteTrack = track as JitsiRemoteTrack;
    const participantId = remoteTrack.getParticipantId();

    if (remoteTrack.isAudioTrack()) {
      this.options.onRemoteAudioTrackRemoved?.(participantId);
    } else if (remoteTrack.isVideoTrack()) {
      this.options.onRemoteVideoTrackRemoved?.(participantId, remoteTrack.getOriginalStream());
    }
  }

  private onUserLeft(participantId: string): void {
    this.options.onParticipantLeft?.(participantId);
  }

  async setMicMuted(muted: boolean): Promise<void> {
    if (!this.localAudioTrack) return;
    await (muted ? this.localAudioTrack.mute() : this.localAudioTrack.unmute());
  }

  /**
   * Включает/выключает камеру. Камера по умолчанию не запрашивается при входе (withVideo=false),
   * поэтому при первом включении видеодорожка создаётся «по требованию» и публикуется в
   * конференции. Раньше setCameraMuted при отсутствии дорожки молча ничего не делал, и видео
   * нельзя было включить вообще. Возвращает false, если камеру включить нельзя (нет дорожки/
   * библиотека не загружена); при отказе в доступе к камере бросает ошибку браузера.
   */
  async setCameraMuted(muted: boolean): Promise<boolean> {
    // Пока идёт демонстрация экрана, в конференции уже есть одна видеодорожка — вторую не добавляем.
    if (this.screenTrack) return false;
    if (muted) {
      if (this.localVideoTrack) await this.localVideoTrack.mute();
      return true;
    }
    if (this.localVideoTrack) {
      await this.localVideoTrack.unmute();
      return true;
    }
    if (!this.JitsiMeetJS) return false;
    const tracks = await this.JitsiMeetJS.createLocalTracks({ devices: ["video"], resolution: "720" });
    const video = tracks.find(t => t.isVideoTrack());
    if (!video) {
      await Promise.all(tracks.map(t => t.dispose().catch(() => undefined)));
      return false;
    }
    this.localVideoTrack = video;
    this.options.onLocalVideoTrack?.(video.getOriginalStream(), video);
    if (this.conference) await this.conference.addTrack(video);
    return true;
  }

  /** Демонстрация экрана поддерживается браузером (на телефонах обычно нет). */
  static isScreenShareSupported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function";
  }

  isScreenSharing(): boolean {
    return this.screenTrack !== null;
  }

  /**
   * Начинает показ экрана: браузер сам спрашивает, что показывать. Камера (если была включена)
   * на время показа заменяется экраном и возвращается при остановке.
   * Возвращает "cancelled", если человек закрыл окно выбора, не выбрав экран.
   */
  async startScreenShare(): Promise<"started" | "cancelled"> {
    if (this.screenTrack) return "started";
    if (!this.JitsiMeetJS || !this.conference) throw new Error("Звонок ещё не начался");

    let tracks: JitsiLocalTrack[];
    try {
      tracks = await this.JitsiMeetJS.createLocalTracks({ devices: ["desktop"] });
    } catch (e) {
      const err = e as { name?: string; message?: string };
      console.error("[tolk-share] createLocalTracks(desktop) failed:", err?.name, err?.message, e);
      // Закрытие окна выбора экрана — не ошибка. Любой другой отказ показываем с причиной.
      if (`${err?.name ?? ""}`.toLowerCase().includes("user_canceled") || `${err?.message ?? ""}`.toLowerCase().includes("user cancel")) {
        return "cancelled";
      }
      throw e;
    }
    console.info("[tolk-share] получены дорожки:", tracks.map(t => `${t.getType()}/${t.videoType ?? "-"}`).join(", "));
    // Если человек поставил «поделиться звуком», лишние аудиодорожки не публикуем.
    const video = tracks.find(t => t.isVideoTrack());
    await Promise.all(tracks.filter(t => t !== video).map(t => t.dispose().catch(() => undefined)));
    if (!video) return "cancelled";

    // Нативная кнопка браузера «Прекратить показ» завершает дорожку — узнаём об этом.
    video.getTrack().addEventListener("ended", () => {
      if (this.screenTrack === video) {
        void this.stopScreenShare().finally(() => this.options.onScreenShareEnded?.());
      }
    });

    try {
      if (this.localVideoTrack) {
        await this.conference.replaceTrack(this.localVideoTrack, video);
      } else {
        await this.conference.addTrack(video);
      }
    } catch (e) {
      console.error("[tolk-share] не удалось опубликовать экран в конференции:", e);
      await video.dispose().catch(() => undefined);
      throw e;
    }
    this.screenTrack = video;
    console.info("[tolk-share] экран опубликован, камера была:", !!this.localVideoTrack);
    return "started";
  }

  /** Останавливает показ экрана и возвращает камеру, если она была. Идемпотентен. */
  async stopScreenShare(): Promise<void> {
    const screen = this.screenTrack;
    if (!screen) return;
    this.screenTrack = null;
    try {
      if (this.conference) {
        if (this.localVideoTrack) await this.conference.replaceTrack(screen, this.localVideoTrack);
        else await this.conference.removeTrack(screen);
      }
      console.info("[tolk-share] показ экрана остановлен");
    } catch (e) {
      console.error("[tolk-share] ошибка при остановке показа:", e);
    } finally {
      await screen.dispose().catch(() => undefined);
    }
  }

  isMicMuted(): boolean {
    return this.localAudioTrack?.isMuted() ?? true;
  }

  isCameraMuted(): boolean {
    return this.localVideoTrack?.isMuted() ?? true;
  }
}

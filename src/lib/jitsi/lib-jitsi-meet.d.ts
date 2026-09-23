// ============================================================
// Минимальные типы для lib-jitsi-meet (npm 1.0.6): пакет публикуется
// как собранный UMD-бандл (dist/lib-jitsi-meet.min.js) без поля
// "types" в package.json — официальных .d.ts для этой версии нет.
// Здесь описана ТОЛЬКО та часть API, которую использует
// src/lib/jitsi/connection.ts. Если понадобится больше методов —
// дополнять по мере необходимости, не пытаться описать всё API.
// Источник сверки сигнатур: https://github.com/jitsi/lib-jitsi-meet
// (JitsiConnection.ts, JitsiConference.ts, JitsiMeetJS.ts, ветка
// master на 22.09.2026 — сама npm-версия 1.0.6 типов не публикует).
// ============================================================
declare module "lib-jitsi-meet" {
  export type JitsiMediaType = "audio" | "video";

  export interface JitsiTrack {
    getOriginalStream(): MediaStream;
    getTrack(): MediaStreamTrack;
    getType(): JitsiMediaType;
    isLocal(): boolean;
    isAudioTrack(): boolean;
    isVideoTrack(): boolean;
    isMuted(): boolean;
    dispose(): Promise<void>;
  }

  export interface JitsiLocalTrack extends JitsiTrack {
    mute(): Promise<void>;
    unmute(): Promise<void>;
  }

  export interface JitsiRemoteTrack extends JitsiTrack {
    /** endpoint id участника-владельца дорожки. */
    getParticipantId(): string;
  }

  export interface JitsiParticipant {
    getId(): string;
    getDisplayName(): string | undefined;
  }

  export interface JitsiConference {
    join(password?: string): void;
    leave(reason?: string): Promise<void>;
    addTrack(track: JitsiLocalTrack): Promise<void>;
    removeTrack(track: JitsiLocalTrack): Promise<void>;
    isJoined(): boolean;
    getParticipants(): JitsiParticipant[];
    getParticipantById(id: string): JitsiParticipant | undefined;
    setReceiverConstraints(constraints: Record<string, unknown>): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, listener: (...args: any[]) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    off(event: string, listener: (...args: any[]) => void): void;
  }

  export interface JitsiConnectOptions {
    id?: string;
    name?: string;
    password?: string;
  }

  export class JitsiConnection {
    constructor(
      appId: string | undefined,
      token: string | null,
      options: Record<string, unknown>
    );
    connect(options?: JitsiConnectOptions): void;
    disconnect(...args: unknown[]): boolean | Promise<void>;
    initJitsiConference(name: string | null, options: Record<string, unknown>): JitsiConference;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addEventListener(event: string, listener: (...args: any[]) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    removeEventListener(event: string, listener: (...args: any[]) => void): void;
  }

  export interface CreateLocalTracksOptions {
    devices?: Array<"audio" | "video" | "desktop">;
    micDeviceId?: string;
    cameraDeviceId?: string;
    resolution?: string;
  }

  export interface JitsiLogLevels {
    TRACE: unknown;
    DEBUG: unknown;
    INFO: unknown;
    LOG: unknown;
    WARN: unknown;
    ERROR: unknown;
  }

  export interface JitsiMeetJSStatic {
    JitsiConnection: typeof JitsiConnection;
    init(options?: Record<string, unknown>): void;
    setLogLevel(level: unknown): void;
    logLevels: JitsiLogLevels;
    createLocalTracks(options?: CreateLocalTracksOptions): Promise<JitsiLocalTrack[]>;
    events: {
      connection: Record<string, string>;
      conference: Record<string, string>;
    };
    isWebRtcSupported(): boolean;
  }

  const JitsiMeetJS: JitsiMeetJSStatic;
  export default JitsiMeetJS;
}

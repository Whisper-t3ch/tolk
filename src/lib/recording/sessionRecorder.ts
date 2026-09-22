// ============================================================
// Оркестрация записи консультации: две независимые дорожки в браузере
// психолога — его собственный микрофон и удалённый аудиопоток клиента.
//
// Дорожки стартуют в разное время: микрофон психолога доступен сразу
// после preflight, а дорожка клиента появляется только когда он
// подключился к звонку. Поэтому запись психолога не ждёт клиента —
// иначе начало консультации было бы потеряно, — а дорожка клиента
// подключается через attachRemoteStream() по факту появления.
//
// На устройстве клиента при этом не происходит ничего: рекордер не
// создаётся, IndexedDB под аудио не используется, выгрузка не идёт.
// Клиент участвует в обычном WebRTC-звонке и видит индикатор записи.
// ============================================================

import type { RecordedChunk, RecordingManifest, TrackRole, TrackStatus } from "./types";
import { TrackRecorder, DEFAULT_TIMESLICE_MS } from "./trackRecorder";

export interface SessionRecorderOptions {
  sessionId: string;
  /** Локальный микрофон психолога — получен через getUserMedia. */
  localStream: MediaStream;
  /** Дорожка клиента, если она уже есть на момент старта. */
  remoteStream?: MediaStream;
  timesliceMs?: number;
  mimeType?: string;
  onChunk: (chunk: RecordedChunk) => void;
  onStatusChange?: (status: RecordingStatusSnapshot) => void;
  now?: () => number;
}

/** Сводка для heartbeat и для индикатора записи в интерфейсе психолога. */
export interface RecordingStatusSnapshot {
  sessionId: string;
  recording: boolean;
  tracks: TrackStatus[];
  /** true, если дорожка клиента ещё ни разу не подключалась. */
  awaitingClient: boolean;
}

export class SessionRecorder {
  private readonly sessionId: string;
  private readonly options: SessionRecorderOptions;
  private readonly recorders = new Map<TrackRole, TrackRecorder>();

  private startedAt: Date | null = null;
  private finishedAt: Date | null = null;
  private clientEverAttached = false;

  constructor(options: SessionRecorderOptions) {
    this.sessionId = options.sessionId;
    this.options = options;
  }

  /** Запускает дорожку психолога; дорожку клиента — если поток уже есть. */
  start(): void {
    this.startedAt = new Date();
    this.startTrack("psychologist", this.options.localStream);
    if (this.options.remoteStream) {
      this.attachRemoteStream(this.options.remoteStream);
    }
  }

  /**
   * Клиент подключился (или переподключился) — появился новый remote
   * MediaStream. При переподключении нумерация фрагментов продолжается
   * сквозной, чтобы backend видел непрерывную последовательность.
   */
  attachRemoteStream(stream: MediaStream): void {
    this.clientEverAttached = true;
    const existing = this.recorders.get("client");
    if (existing) {
      void existing.replaceStream(stream);
      return;
    }
    this.startTrack("client", stream);
  }

  private startTrack(role: TrackRole, stream: MediaStream): void {
    const recorder = new TrackRecorder({
      role,
      stream,
      timesliceMs: this.options.timesliceMs ?? DEFAULT_TIMESLICE_MS,
      mimeType: this.options.mimeType,
      now: this.options.now,
      onChunk: this.options.onChunk,
      onStateChange: () => this.emitStatus(),
    });
    this.recorders.set(role, recorder);
    recorder.start();
    this.emitStatus();
  }

  getStatus(): RecordingStatusSnapshot {
    const tracks = [...this.recorders.values()].map(r => r.getStatus());
    return {
      sessionId: this.sessionId,
      recording: tracks.some(t => t.state === "recording"),
      tracks,
      awaitingClient: !this.clientEverAttached,
    };
  }

  /**
   * Останавливает обе дорожки, дожидается последних фрагментов и
   * возвращает manifest. Backend по нему проверяет, что все номера на
   * месте, нет дублей и дорожки не разъехались по длительности —
   * только после этого сессия становится готовой к расшифровке.
   */
  async stop(): Promise<RecordingManifest> {
    await Promise.all([...this.recorders.values()].map(r => r.stop()));
    this.finishedAt = new Date();
    this.emitStatus();

    const tracks: RecordingManifest["tracks"] = [...this.recorders.entries()].map(([role, recorder]) => {
      const status = recorder.getStatus();
      const chunkCount = recorder.getChunkCount();
      return {
        role,
        mimeType: status.mimeType,
        firstSequence: chunkCount > 0 ? 0 : -1,
        lastSequence: chunkCount - 1,
        chunkCount,
        totalDurationMs: Math.round(recorder.getTotalDurationMs()),
        state: status.state,
      };
    });

    return {
      sessionId: this.sessionId,
      startedAt: (this.startedAt ?? new Date()).toISOString(),
      finishedAt: this.finishedAt.toISOString(),
      tracks,
    };
  }

  private emitStatus(): void {
    this.options.onStatusChange?.(this.getStatus());
  }
}

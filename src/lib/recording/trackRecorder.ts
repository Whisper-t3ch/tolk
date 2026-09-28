// ============================================================
// Запись ОДНОЙ аудиодорожки через MediaRecorder с нарезкой на фрагменты.
//
// MediaRecorder.start(timeslice) сам отдаёт Blob каждые timeslice мс
// через dataavailable — не нужно останавливать и перезапускать запись,
// чтобы получить фрагмент. Это важно: перезапуск дал бы разрыв между
// фрагментами, а нам нужна непрерывная дорожка.
//
// Нарезка 15-30 секунд — компромисс: короче тем больше накладных
// расходов на запросы выгрузки, длиннее тем больше теряется при
// внезапном закрытии вкладки (последний ненарезанный фрагмент потерян
// всегда — это принципиальная цена браузерной записи).
//
// Класс намеренно ничего не знает ни о Jitsi, ни о выгрузке: он
// получает MediaStream и отдаёт фрагменты через колбэк. Буферизация
// (IndexedDB) и выгрузка живут отдельно, чтобы их можно было
// тестировать и чинить независимо от захвата звука.
// ============================================================

import type { RecordedChunk, StopDiagnosticEvent, TrackRole, TrackState, TrackStatus } from "./types";
import { checksumBlob } from "./checksum";
import { selectMimeType } from "./mime";

/** 20 секунд — середина рекомендованного диапазона 15-30с. */
export const DEFAULT_TIMESLICE_MS = 20_000;

export interface TrackRecorderOptions {
  role: TrackRole;
  stream: MediaStream;
  timesliceMs?: number;
  /** Принудительный MIME (для тестов). По умолчанию выбирается в runtime. */
  mimeType?: string;
  onChunk: (chunk: RecordedChunk) => void;
  onStateChange?: (status: TrackStatus) => void;
  /**
   * Диагностика остановки (25.09.2026) — см. StopDiagnosticEvent в
   * types.ts. Необязательный колбэк: без него класс ведёт себя как
   * раньше, просто без телеметрии.
   */
  onDiagnostic?: (event: StopDiagnosticEvent) => void;
  /** Источник монотонного времени — подменяется в тестах. */
  now?: () => number;
}

/** Сколько ждать событие stop у MediaRecorder, прежде чем считать остановку зависшей. */
const STOP_TIMEOUT_MS = 5_000;

export class TrackRecorderError extends Error {
  constructor(
    message: string,
    public code: "no_mime" | "no_audio_track" | "recorder_failed"
  ) {
    super(message);
    this.name = "TrackRecorderError";
  }
}

export class TrackRecorder {
  private readonly role: TrackRole;
  private readonly timesliceMs: number;
  private readonly onChunk: (chunk: RecordedChunk) => void;
  private readonly onStateChange?: (status: TrackStatus) => void;
  private readonly onDiagnostic?: (event: StopDiagnosticEvent) => void;
  private readonly now: () => number;
  /** true между stop_requested и разрешением промиса stop() — см. ondataavailable в start(). */
  private stopping = false;

  private stream: MediaStream;
  private recorder: MediaRecorder | null = null;
  private audioTrack: MediaStreamTrack | null = null;

  private state: TrackState = "idle";
  private mimeType: string | null = null;
  private error: string | null = null;

  private sequence = 0;
  private startedAt = 0;
  /** Смещение конца предыдущего фрагмента от старта записи, мс. */
  private previousOffsetMs = 0;
  /** Сериализация обработки фрагментов: checksum асинхронный, а порядок номеров важен. */
  private chunkQueue: Promise<void> = Promise.resolve();

  constructor(options: TrackRecorderOptions) {
    this.role = options.role;
    this.stream = options.stream;
    this.timesliceMs = options.timesliceMs ?? DEFAULT_TIMESLICE_MS;
    this.onChunk = options.onChunk;
    this.onStateChange = options.onStateChange;
    this.onDiagnostic = options.onDiagnostic;
    this.now = options.now ?? (() => performance.now());
    this.mimeType = options.mimeType ?? null;
  }

  getStatus(): TrackStatus {
    return {
      role: this.role,
      state: this.state,
      lastChunkSequence: this.sequence - 1,
      mimeType: this.mimeType,
      error: this.error,
    };
  }

  /** Суммарная длительность нарезанного, мс — для manifest. */
  getTotalDurationMs(): number {
    return this.previousOffsetMs;
  }

  getChunkCount(): number {
    return this.sequence;
  }

  start(): void {
    if (this.state === "recording") return;
    // Сброс на случай повторного start() после replaceStream() —
    // иначе this.stopping навсегда осталась бы true после первой же
    // остановки, и каждый обычный dataavailable новой дорожки ложно
    // помечался бы диагностикой dataavailable_during_stop.
    this.stopping = false;

    const audioTracks = this.stream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.fail("no_audio_track", "В потоке нет аудиодорожки");
      throw new TrackRecorderError(`Дорожка ${this.role}: в потоке нет аудио`, "no_audio_track");
    }

    const mimeType = this.mimeType ?? selectMimeType();
    if (!mimeType) {
      this.fail("no_mime", "Браузер не поддерживает ни один аудиоформат записи");
      throw new TrackRecorderError("Браузер не поддерживает запись аудио", "no_mime");
    }
    this.mimeType = mimeType;

    try {
      this.recorder = new MediaRecorder(this.stream, { mimeType });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.fail("recorder_failed", message);
      throw new TrackRecorderError(`Не удалось создать MediaRecorder: ${message}`, "recorder_failed");
    }

    this.attachTrackListeners(audioTracks[0]);

    this.recorder.ondataavailable = event => {
      // Данные никогда не отбрасываем независимо от того, идёт ли сейчас
      // stop() — потерять реальный звук хуже, чем прислать "лишний"
      // диагностический сигнал. Событие ПОСЛЕ старта stop() само по себе
      // не аномалия (спецификация гарантирует финальный dataavailable
      // именно в рамках stop()) — аномалия только если оно приходит
      // ПОСЛЕ того, как stop() уже отдал управление вызывающему (см.
      // stop() ниже: слушатель снимается только после этого).
      if (this.stopping) {
        this.emitDiagnostic({ event: "dataavailable_during_stop", size: event.data?.size ?? 0 });
      }
      this.enqueueChunk(event.data);
    };
    this.recorder.onerror = event => {
      const err = (event as unknown as { error?: DOMException }).error;
      this.fail("recorder_failed", err?.message ?? "MediaRecorder сообщил об ошибке");
    };

    this.startedAt = this.now();
    this.previousOffsetMs = 0;
    this.recorder.start(this.timesliceMs);
    this.setState("recording");
  }

  /**
   * Останавливает запись и дожидается, пока последний фрагмент будет
   * нарезан и обработан. MediaRecorder при stop() отдаёт остаток
   * последним dataavailable — его нельзя потерять.
   *
   * ИСПРАВЛЕНО 25.09.2026 (обнаружено живым тестом: запись продолжалась
   * ~142с после того, как этот метод ранее считал её остановленной —
   * см. claude/recording-stop-fix-plan.md в проекте). Раньше метод
   * доверял только событию onstop и НИКОГДА не проверял
   * recorder.state после его срабатывания, а исключение из
   * recorder.stop() молча проглатывалось — то есть "остановлено"
   * репортилось на основании одного события, без проверки. По
   * спецификации (MediaStream Recording, dom-mediarecorder-stop)
   * порядок гарантирован: state переходит в "inactive" → (если есть
   * несданные данные) финальный dataavailable → событие stop. Поэтому
   * САМ ПО СЕБЕ recorder.state==="inactive" ничего не доказывает (он
   * становится таким в начале внутренней задачи stop(), раньше, чем
   * дозаписывается последний фрагмент) — а подтверждение, что остановка РЕАЛЬНО
   * завершилась, даёт только совокупность: событие stop
   * действительно пришло, ошибок не было, и к этому моменту
   * recorder.state равен "inactive". Если хотя бы одно не выполнено
   * (событие не пришло за STOP_TIMEOUT_MS, stop() бросил исключение,
   * либо state внезапно не "inactive") — это явный сбой
   * (this.fail("stop_unconfirmed", ...)), а не молчаливое "stopped":
   * вызывающий код (SessionRecorder → JitsiCallView.finishRecording)
   * обязан увидеть это через getStatus().state==="failed" и НЕ
   * отправлять manifest как успешный (см. claude/recording-stop-fix-plan.md).
   *
   * Диагностика (state до/после, ошибка stop(), факт и момент
   * dataavailable/onstop) уходит через onDiagnostic — телеметрия для
   * разбора КОНКРЕТНОГО следующего теста, не влияет на решение "success
   * или нет" (оно принимается только по перечисленным выше условиям).
   */
  async stop(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") {
      this.setState("stopped");
      await this.chunkQueue;
      return;
    }

    this.emitDiagnostic({ event: "stop_requested", state: recorder.state });
    this.stopping = true;

    let stopEventReceived = false;
    let stopError: string | null = null;
    let timedOut = false;

    await new Promise<void>(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      recorder.onstop = () => {
        stopEventReceived = true;
        this.emitDiagnostic({ event: "onstop", state: recorder.state });
        finish();
      };

      try {
        recorder.stop();
      } catch (e) {
        stopError = e instanceof Error ? e.message : String(e);
        this.emitDiagnostic({ event: "stop_threw", error: stopError, state: recorder.state });
        finish();
      }

      setTimeout(() => {
        if (settled) return;
        timedOut = true;
        this.emitDiagnostic({ event: "stop_timeout", state: recorder.state });
        finish();
      }, STOP_TIMEOUT_MS);
    });

    // Слушатель дальше не снимаем явно (у MediaRecorder нет штатного
    // способа узнать, что он больше никогда не понадобится) — но
    // this.stopping остаётся true и после этой точки, так что ЛЮБОЙ
    // dataavailable, пришедший ПОСЛЕ того, как stop() отдал управление
    // вызывающему, по-прежнему попадёт в диагностику как
    // dataavailable_during_stop. Это осознанно: если такое событие
    // всё-таки придёт (не должно по спецификации), мы хотим это
    // увидеть, а не тихо потерять сигнал, сняв слушатель слишком рано.

    await this.chunkQueue;

    // TS иначе сузил бы тип recorder.state до исключающего "inactive"
    // из-за ранней проверки в начале метода (`recorder.state ===
    // "inactive"` там) — та проверка была ДО await'ов выше, а между
    // ней и этим чтением recorder.state реально мог измениться
    // (это MediaRecorder, а не наш объект) — приведение типа явно
    // отражает, что здесь это снова любое из трёх состояний.
    const finalState = recorder.state as RecordingState;
    const confirmed = stopEventReceived && !stopError && finalState === "inactive";

    this.emitDiagnostic({
      event: "stop_result",
      state: finalState,
      confirmed,
      error: stopError ?? (timedOut ? "onstop не пришёл за STOP_TIMEOUT_MS" : undefined),
    });

    if (!confirmed) {
      this.fail(
        "recorder_failed",
        `Остановка записи не подтверждена: onstop=${stopEventReceived}, state=${finalState}, error=${stopError ?? (timedOut ? "timeout" : "нет")}`
      );
      return;
    }
    if (this.state !== "failed") this.setState("stopped");
  }

  /**
   * Переподключение клиента: remote track пересоздаётся, старый
   * MediaRecorder к нему уже не привязать. Нумерация фрагментов
   * продолжается сквозной, поэтому backend увидит непрерывную
   * последовательность, а разрыв виден по скачку startedAtMs.
   */
  async replaceStream(stream: MediaStream): Promise<void> {
    const carriedOffset = this.previousOffsetMs;
    await this.stop();
    this.stream = stream;
    this.recorder = null;
    this.error = null;
    this.start();
    // start() обнулил смещение — восстанавливаем, чтобы тайминги
    // оставались сквозными по всей сессии, а не по одному сегменту.
    this.previousOffsetMs = carriedOffset;
    this.startedAt = this.now() - carriedOffset;
  }

  private attachTrackListeners(track: MediaStreamTrack): void {
    this.audioTrack = track;
    // ended = дорожка исчезла насовсем (клиент вышел, устройство отвалилось).
    // mute/unmute = временная тишина (клиент выключил микрофон) — запись
    // продолжается и пишет тишину, это не потеря дорожки.
    track.addEventListener("ended", () => {
      if (this.state === "recording") this.setState("track_lost");
    });
  }

  private enqueueChunk(blob: Blob): void {
    // Пустые Blob случаются (браузер отдал событие без данных). Номер не
    // тратим, иначе в последовательности появится дыра, которую backend
    // не отличит от потерянного фрагмента.
    if (!blob || blob.size === 0) return;

    const receivedAt = this.now();
    this.chunkQueue = this.chunkQueue
      .then(async () => {
        const offsetMs = Math.max(0, receivedAt - this.startedAt);
        const startedAtMs = this.previousOffsetMs;
        const durationMs = Math.max(0, Math.round(offsetMs - startedAtMs));
        this.previousOffsetMs = startedAtMs + durationMs;

        const chunk: RecordedChunk = {
          role: this.role,
          sequence: this.sequence++,
          blob,
          startedAtMs: Math.round(startedAtMs),
          durationMs,
          mimeType: this.mimeType ?? blob.type,
          size: blob.size,
          checksum: await checksumBlob(blob),
        };
        this.onChunk(chunk);
      })
      .catch(e => {
        this.fail("recorder_failed", e instanceof Error ? e.message : String(e));
      });
  }

  private fail(_code: string, message: string): void {
    this.error = message;
    this.setState("failed");
  }

  private emitDiagnostic(event: Omit<StopDiagnosticEvent, "role" | "ts">): void {
    this.onDiagnostic?.({ role: this.role, ts: this.now(), ...event });
  }

  private setState(state: TrackState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(this.getStatus());
  }
}

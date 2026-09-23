// ============================================================
// lib-jitsi-meet НЕ загружается через npm-пакет — вместо этого runtime
// подгружает lib-jitsi-meet.min.js динамическим <script>-тегом прямо с
// того же Jitsi-сервера, к которому будем подключаться
// (https://{домен}/libs/lib-jitsi-meet.min.js — тот же путь, что
// использует официальный веб-клиент Jitsi Meet в своём index.html).
//
// 23.09, живой тест в браузере (Vercel Preview, см.
// claude/browser-recording-architecture-spec.md в проекте): у
// lib-jitsi-meet нет официального npm-пакета (community.jitsi.org,
// тред "Official lib-jitsi-meet npm package?" — рекомендация оттуда:
// "версии библиотеки следуют за деплоем", т.е. брать её с того же
// сервера, к которому подключаешься, а не как отдельную npm-зависимость).
// Сторонний паблиш "lib-jitsi-meet"@1.0.6, который раньше стоял здесь
// (import("lib-jitsi-meet")), собран со Strophe как внешней
// (externals) зависимостью — его dist/lib-jitsi-meet.min.js падает в
// рантайме с "ReferenceError: Strophe is not defined" на первой же
// попытке создать JitsiConnection (see github.com/jitsi/lib-jitsi-meet
// issue #484 — тот же баг, известный и задокументированный). tsc это
// не ловит вообще: ошибка чисто рантаймовая, конструктор JitsiConnection
// в .d.ts типизирован без исполнения реального кода. Воспроизведено и
// исправление подтверждено живым тестом двух вкладок в браузере
// 23.09 — см. запись в статус-документе.
//
// Официальная сборка lib-jitsi-meet требует форкнутый Jitsi-строфи
// (github.com/jitsi/strophejs, патч "-jitsi-N"), несовместимый с
// обычным npm strophe.js — подставлять его отдельно рискованно без
// повторения сборки самого lib-jitsi-meet. Поэтому берём готовый,
// гарантированно совместимый бандл с сервера: он уже содержит Strophe
// внутри (подтверждено — после загрузки скрипта window.Strophe
// определён без каких-либо дополнительных скриптов).
//
// Из этого следует, что используемый домен НЕ захардкожен — при
// переходе на собственную ВМ (см. config.ts, getJitsiDomain())
// скрипт будет грузиться уже оттуда, той версии, что реально раздаёт
// эта ВМ — ровно то поведение, которое нужно (см. комментарий в
// config.ts про "поменяется только адрес сервера").
//
// Модуль по-прежнему трогает window/document — грузить ТОЛЬКО в
// браузере из useEffect/обработчика, никогда на верхнем уровне модуля.
//
// JitsiMeetJS.init() — глобальная инициализация (Statistics, RTC,
// Settings). Кешируем промис на модуль, а не на компонент: два
// смонтированных JitsiCallView (маловероятно, но не исключено при
// React Strict Mode/Fast Refresh) не должны звать init() дважды.
// ============================================================
import type { JitsiMeetJSStatic } from "lib-jitsi-meet";
import { getJitsiDomain } from "./config";

declare global {
  interface Window {
    JitsiMeetJS?: JitsiMeetJSStatic;
  }
}

const SCRIPT_MARKER_ATTR = "data-jitsi-loader";

let loadPromise: Promise<JitsiMeetJSStatic> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Уже есть такой тег в DOM (например, после React Fast Refresh
    // в деве) — не грузим второй раз, дожидаемся того же промиса.
    const existing = document.querySelector<HTMLScriptElement>(
      `script[${SCRIPT_MARKER_ATTR}="${src}"]`
    );
    if (existing) {
      if (window.JitsiMeetJS) {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error(`Не удалось загрузить ${src}`)), {
          once: true,
        });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.setAttribute(SCRIPT_MARKER_ATTR, src);
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`Не удалось загрузить ${src} — сеть недоступна или сервер не отвечает`));
    document.head.appendChild(script);
  });
}

export function loadJitsiMeetJS(): Promise<JitsiMeetJSStatic> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("loadJitsiMeetJS вызван вне браузера (SSR?)"));
  }

  if (!loadPromise) {
    const domain = getJitsiDomain();
    const src = `https://${domain}/libs/lib-jitsi-meet.min.js`;

    loadPromise = loadScript(src)
      .then(() => {
        const JitsiMeetJS = window.JitsiMeetJS;
        if (!JitsiMeetJS) {
          throw new Error(`Скрипт ${src} загрузился, но не определил window.JitsiMeetJS`);
        }

        JitsiMeetJS.init({
          disableAudioLevels: false,
          enableAnalyticsLogging: false,
        });
        // По умолчанию lib-jitsi-meet многословен в консоли — оставляем
        // только предупреждения и ошибки, чтобы не заглушать реальные
        // логи приложения психолога.
        JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.WARN);

        return JitsiMeetJS;
      })
      .catch(e => {
        // Не кешируем неудачную попытку — следующий вызов (например,
        // повтор после смены сети) должен попробовать снова, а не
        // навсегда унаследовать одну и ту же ошибку.
        loadPromise = null;
        throw e;
      });
  }

  return loadPromise;
}

// ============================================================
// lib-jitsi-meet публикуется как собранный UMD-бандл
// (dist/lib-jitsi-meet.min.js) и на уровне модуля трогает
// window/navigator/WebSocket — импортировать его можно ТОЛЬКО в
// браузере, никогда во время SSR или статического анализа сборки
// Next.js. Поэтому загрузка идёт через динамический import() внутри
// функции; вызывающий код обязан звать loadJitsiMeetJS() только из
// useEffect/обработчика события (после монтирования компонента на
// клиенте), никогда на верхнем уровне модуля.
//
// JitsiMeetJS.init() — глобальная инициализация (Statistics, RTC,
// Settings). Кешируем промис на модуль, а не на компонент: два
// смонтированных JitsiCallView (маловероятно, но не исключено при
// React Strict Mode/Fast Refresh) не должны звать init() дважды.
// ============================================================
import type { JitsiMeetJSStatic } from "lib-jitsi-meet";

let loadPromise: Promise<JitsiMeetJSStatic> | null = null;

export function loadJitsiMeetJS(): Promise<JitsiMeetJSStatic> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("loadJitsiMeetJS вызван вне браузера (SSR?)"));
  }

  if (!loadPromise) {
    loadPromise = import("lib-jitsi-meet")
      .then(mod => {
        const JitsiMeetJS = (mod as { default?: JitsiMeetJSStatic }).default ?? (mod as unknown as JitsiMeetJSStatic);

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

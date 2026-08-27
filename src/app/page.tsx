"use client";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  CheckCircle,
  Users,
  Zap,
  Shield,
  MessageSquare,
  Calendar,
  FileText,
  BarChart3,
  Clock,
  Smartphone,
  Lightbulb,
  ChevronDown,
  PlayCircle,
  Sparkles,
  Send,
  Bot,
  ClipboardList,
  ShieldCheck,
  ListChecks,
  Video,
  Mic,
  BookOpen,
  CreditCard,
  TrendingUp,
  PieChart,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LogoMark } from "@/components/Logo";

// Custom Icons
const IconMicrophone = () => (
  <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M28 38C33.5228 38 38 33.5228 38 28V16C38 10.4772 33.5228 6 28 6C22.4772 6 18 10.4772 18 16V28C18 33.5228 22.4772 38 28 38Z" stroke="#2D6A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M14 28C14 36.8366 20.1634 44 28 44C35.8366 44 42 36.8366 42 28" stroke="#2D6A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M28 44V50" stroke="#2D6A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    {[0, 0.2, 0.4].map((delay, i) => (
      <motion.path
        key={i}
        d={`M${42 + i * 4} 22Q${46 + i * 4} 22 ${46 + i * 4} 26`}
        stroke="#2D6A5C" strokeWidth="2" strokeLinecap="round" fill="none"
        animate={{ opacity: [0, 1, 0] }}
        transition={{ duration: 1.2, repeat: Infinity, delay }}
      />
    ))}
    {[0, 0.15, 0.3, 0.45].map((delay, i) => (
      <motion.rect
        key={i}
        x={20 + i * 5} y="18" width="2" height="12" rx="1" fill="#2D6A5C"
        animate={{ scaleY: [0.4, 1, 0.4], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay }}
        style={{ transformOrigin: "center" }}
      />
    ))}
  </svg>
);

const IconBrain = () => (
  <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M28 10C22 10 18 14 18 20C18 24 20 27 22 29M28 10C34 10 38 14 38 20C38 24 36 27 34 29M22 29C20 31 20 34 22 37C24 40 28 42 28 42C28 42 32 40 34 37C36 34 36 31 34 29M22 29H34" stroke="#1BAF7A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="28" cy="42" r="8" stroke="#1BAF7A" strokeWidth="2.5"/>
    <motion.circle
      r="2" fill="#F59E0B"
      animate={{ cx: [22, 28, 34, 28, 22], cy: [16, 10, 16, 29, 16] }}
      transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
    />
  </svg>
);

const IconPencil = () => (
  <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M40.5 10.5L45.5 15.5M10 46L16 42.5L42 16.5L46.5 21.5L20.5 47.5L10 46Z" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    <motion.path
      d="M14 43L18 44.5L19.5 40.5"
      stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: [0, 1, 1, 0] }}
      transition={{ duration: 1.6, repeat: Infinity, times: [0, 0.4, 0.7, 1] }}
    />
  </svg>
);

const IconCheckmark = () => (
  <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <motion.circle
      cx="28" cy="28" r="22" stroke="#1BAF7A" strokeWidth="2.5" fill="none"
      animate={{ opacity: [1, 0.4, 1] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
    />
    <motion.path
      d="M12 28L22 38L44 16"
      stroke="#1BAF7A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: [0, 1, 1, 0] }}
      transition={{ duration: 1.6, repeat: Infinity, times: [0, 0.45, 0.8, 1] }}
    />
  </svg>
);

// Animated icons for the "Инструменты и возможности" feature grid (no rotation)
const IconAnimatedChat = () => (
  <svg width="28" height="28" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 14C8 11.2386 10.2386 9 13 9H43C45.7614 9 48 11.2386 48 14V32C48 34.7614 45.7614 37 43 37H24L14 45V37H13C10.2386 37 8 34.7614 8 32V14Z" stroke="#2D6A5C" strokeWidth="2.5" strokeLinejoin="round"/>
    {[0, 0.15, 0.3].map((delay, i) => (
      <motion.circle
        key={i} cx={20 + i * 8} cy="23" r="2.2" fill="#2D6A5C"
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay }}
      />
    ))}
  </svg>
);

const IconAnimatedCalendar = () => (
  <svg width="28" height="28" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="9" y="12" width="38" height="34" rx="4" stroke="#1BAF7A" strokeWidth="2.5"/>
    <path d="M9 21H47" stroke="#1BAF7A" strokeWidth="2.5"/>
    <path d="M18 7V15M38 7V15" stroke="#1BAF7A" strokeWidth="2.5" strokeLinecap="round"/>
    <motion.rect
      x="16" y="27" width="8" height="8" rx="2" fill="#1BAF7A"
      animate={{ opacity: [0.25, 1, 0.25] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
    />
    <motion.circle
      cx="38" cy="31" r="3" fill="#1BAF7A"
      animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
    />
  </svg>
);

const IconAnimatedDocument = () => (
  <svg width="28" height="28" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 8H33L42 17V48H14V8Z" stroke="#F59E0B" strokeWidth="2.5" strokeLinejoin="round"/>
    <path d="M33 8V17H42" stroke="#F59E0B" strokeWidth="2.5" strokeLinejoin="round"/>
    {[24, 30, 36].map((y, i) => (
      <motion.path
        key={i}
        d={`M19 ${y}H33`}
        stroke="#F59E0B" strokeWidth="2.2" strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: [0, 1, 1, 0] }}
        transition={{ duration: 2.1, repeat: Infinity, times: [0, 0.3, 0.85, 1], delay: i * 0.25 }}
      />
    ))}
  </svg>
);

const IconAnimatedAnalytics = () => (
  <svg width="28" height="28" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 46H46" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round"/>
    {[
      { x: 15, h: 14, delay: 0 },
      { x: 25, h: 22, delay: 0.15 },
      { x: 35, h: 10, delay: 0.3 },
      { x: 43, h: 28, delay: 0.45 },
    ].map((bar, i) => (
      <motion.rect
        key={i}
        x={bar.x} width="6" rx="2" fill="#8B5CF6"
        initial={{ height: 4, y: 42 }}
        animate={{ height: [4, bar.h, bar.h * 0.7, bar.h], y: [42, 42 - bar.h, 42 - bar.h * 0.7, 42 - bar.h] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: bar.delay }}
      />
    ))}
  </svg>
);

const IconAnimatedPayment = () => (
  <svg width="28" height="28" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="7" y="14" width="42" height="30" rx="4" stroke="#EC4899" strokeWidth="2.5"/>
    <path d="M7 22H49" stroke="#EC4899" strokeWidth="2.5"/>
    <motion.rect
      x="13" y="30" width="14" height="5" rx="1.5" fill="#EC4899"
      animate={{ opacity: [0.3, 1, 0.3] }}
      transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
    />
    <motion.circle
      r="2" fill="#EC4899"
      animate={{ cx: [13, 44, 44], cy: [37, 37, 37], opacity: [0, 1, 0] }}
      transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
    />
  </svg>
);

const IconAnimatedAssistant = () => (
  <svg width="28" height="28" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M28 6L32 16L42 16L34 23L37 34L28 27L19 34L22 23L14 16L24 16L28 6Z" stroke="#06B6D4" strokeWidth="2.2" strokeLinejoin="round"/>
    <motion.circle
      r="2" fill="#06B6D4"
      animate={{ cx: [16, 28, 40, 28, 16], cy: [40, 46, 40, 46, 40], opacity: [0.4, 1, 0.4, 1, 0.4] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
    />
    <motion.path
      d="M28 6L32 16L42 16L34 23L37 34L28 27L19 34L22 23L14 16L24 16L28 6Z"
      fill="#06B6D4"
      animate={{ opacity: [0, 0.35, 0] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
    />
  </svg>
);

// Animated icons — "wow" replacements for benefit-card emojis (no rotation — gravity/pulse/travel based)
const IconAnimatedClock = () => (
  <svg width="46" height="46" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Песочные часы: песок пересыпается сверху вниз */}
    <path d="M16 8H40M16 48H40" stroke="#2D6A5C" strokeWidth="3" strokeLinecap="round"/>
    <path d="M18 8C18 8 18 20 28 27C38 20 38 8 38 8" stroke="#2D6A5C" strokeWidth="2.5" strokeLinejoin="round"/>
    <path d="M18 48C18 48 18 36 28 29C38 36 38 48 38 48" stroke="#2D6A5C" strokeWidth="2.5" strokeLinejoin="round"/>
    <motion.path
      d="M28 27C28 27 25 30 25 33C25 35 26.5 36 28 36C29.5 36 31 35 31 33C31 30 28 27 28 27Z"
      fill="#2D6A5C"
      animate={{ scaleY: [1, 0.2, 1], opacity: [0.9, 0.3, 0.9] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      style={{ transformOrigin: "28px 27px" }}
    />
    {[0, 0.35, 0.7].map((delay, i) => (
      <motion.circle
        key={i}
        cx="28" r="1.4" fill="#2D6A5C"
        animate={{ cy: [28, 44], opacity: [0, 1, 0] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeIn", delay }}
      />
    ))}
  </svg>
);

const IconAnimatedBrain = () => (
  <svg width="46" height="46" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Мозг с бегущими импульсами по нейронным путям */}
    <path d="M28 10C22 10 18 14 18 20C18 24 20 27 22 29M28 10C34 10 38 14 38 20C38 24 36 27 34 29M22 29C20 31 20 34 22 37C24 40 28 42 28 42C28 42 32 40 34 37C36 34 36 31 34 29M22 29H34" stroke="#1BAF7A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="28" cy="42" r="8" stroke="#1BAF7A" strokeWidth="2.5"/>
    <motion.circle
      r="2" fill="#F59E0B"
      animate={{
        cx: [22, 28, 34, 28, 22],
        cy: [16, 10, 16, 29, 16],
        opacity: [1, 1, 1, 1, 1],
      }}
      transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
    />
    <motion.circle
      cx="28" cy="42" r="3" fill="#F59E0B"
      animate={{ opacity: [0.3, 1, 0.3], scale: [1, 1.5, 1] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
    />
  </svg>
);

const IconAnimatedHandshake = () => (
  <svg width="46" height="46" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Чат-пузырь с растущими точками "печатает..." */}
    <path d="M8 14C8 11.2386 10.2386 9 13 9H43C45.7614 9 48 11.2386 48 14V32C48 34.7614 45.7614 37 43 37H24L14 45V37H13C10.2386 37 8 34.7614 8 32V14Z" stroke="#F59E0B" strokeWidth="2.5" strokeLinejoin="round"/>
    {[0, 0.15, 0.3].map((delay, i) => (
      <motion.circle
        key={i}
        cx={20 + i * 8} cy="23" r="2.2" fill="#F59E0B"
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay }}
      />
    ))}
  </svg>
);

const IconAnimatedCoin = () => (
  <svg width="46" height="46" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Стопка монет растёт снизу вверх + плюсик подлетает */}
    <rect x="14" y="38" width="28" height="6" rx="1.5" stroke="#1BAF7A" strokeWidth="2.5" fill="#F5F3EF"/>
    <motion.rect
      x="14" y="28" width="28" height="6" rx="1.5" stroke="#1BAF7A" strokeWidth="2.5" fill="#F5F3EF"
      animate={{ opacity: [0.3, 1, 1], y: [34, 28, 28] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut", times: [0, 0.5, 1] }}
    />
    <motion.rect
      x="14" y="18" width="28" height="6" rx="1.5" stroke="#1BAF7A" strokeWidth="2.5" fill="#FFFFFF"
      animate={{ opacity: [0, 0, 1, 1], y: [34, 24, 18, 18] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut", times: [0, 0.4, 0.85, 1] }}
    />
    <motion.g
      animate={{ opacity: [0, 0, 1, 1], y: [10, 10, 0, 0] }}
      transition={{ duration: 1.4, repeat: Infinity, times: [0, 0.7, 0.95, 1] }}
    >
      <circle cx="42" cy="14" r="7" fill="#1BAF7A"/>
      <path d="M42 11V17M39 14H45" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
    </motion.g>
  </svg>
);

const IconAnimatedLock = () => (
  <svg width="46" height="46" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Щит с расходящимися радар-кольцами защиты */}
    {[0, 0.6, 1.2].map((delay, i) => (
      <motion.circle
        key={i}
        cx="28" cy="26" r="10" stroke="#EF4444" strokeWidth="1.5" fill="none"
        animate={{ r: [10, 24], opacity: [0.6, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay }}
      />
    ))}
    <path d="M28 6L44 12V24C44 34 37 42 28 46C19 42 12 34 12 24V12L28 6Z" fill="#FFF5F5" stroke="#EF4444" strokeWidth="2.5" strokeLinejoin="round"/>
    <motion.path
      d="M20 25L26 31L37 19"
      stroke="#EF4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: [0, 1, 1] }}
      transition={{ duration: 1.8, repeat: Infinity, times: [0, 0.5, 1] }}
    />
  </svg>
);

const IconAnimatedNetwork = () => (
  <svg width="46" height="46" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Люди на орбите вокруг центра — путь по эллипсу без rotate */}
    <circle cx="28" cy="28" r="18" stroke="#8B5CF6" strokeWidth="1.5" strokeDasharray="3 4" opacity="0.4"/>
    <circle cx="28" cy="28" r="7" stroke="#8B5CF6" strokeWidth="2.5" fill="#F5F3EF"/>
    <path d="M28 24.5C29.1 24.5 30 23.6 30 22.5C30 21.4 29.1 20.5 28 20.5C26.9 20.5 26 21.4 26 22.5C26 23.6 26.9 24.5 28 24.5Z" fill="#8B5CF6"/>
    <path d="M24 30C24 27.8 25.8 26.5 28 26.5C30.2 26.5 32 27.8 32 30" stroke="#8B5CF6" strokeWidth="1.8" strokeLinecap="round"/>
    <motion.circle
      r="4.5" fill="#8B5CF6"
      animate={{ cx: [46, 28, 10, 28, 46], cy: [28, 10, 28, 46, 28] }}
      transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
    />
    <motion.circle
      r="4.5" fill="#F59E0B"
      animate={{ cx: [10, 28, 46, 28, 10], cy: [28, 46, 28, 10, 28] }}
      transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
    />
  </svg>
);

// Голосовая дорожка записи — вместо статичной иконки микрофона
const IconVoiceWaveform = () => {
  const bars = [10, 22, 34, 18, 40, 26, 14, 32, 20, 38, 16, 28, 12, 24];
  return (
    <svg width="120" height="56" viewBox="0 0 200 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      {bars.map((h, i) => (
        <motion.rect
          key={i}
          x={i * 14 + 2}
          width="6"
          rx="3"
          fill="#2D6A5C"
          initial={{ height: h * 0.3, y: 28 - (h * 0.3) / 2, opacity: 0.5 }}
          animate={{
            height: [h * 0.3, h, h * 0.3],
            y: [28 - (h * 0.3) / 2, 28 - h / 2, 28 - (h * 0.3) / 2],
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.08,
          }}
        />
      ))}
      <motion.circle
        r="3" fill="#EF4444"
        cx="8" cy="8"
        animate={{ opacity: [1, 0.3, 1] }}
        transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
      />
    </svg>
  );
};

// Интерактивная демка "Спроси что угодно" — по мотивам upheal.io
function AskAnythingDemo() {
  const tabs = [
    {
      id: "before",
      label: "Перед сессией",
      emoji: "📋",
      color: "#2D6A5C",
      questions: [
        "Динамика по клиенту за последние 4 сессии",
        "На чём мы остановились в прошлый раз",
        "Что из техник давало устойчивый результат",
      ],
    },
    {
      id: "during",
      label: "Между сессиями",
      emoji: "💬",
      color: "#F59E0B",
      questions: [
        "Составь домашнее задание по КПТ на тревожность",
        "Подбери методику для оценки уровня стресса",
        "Сформулируй гипотезу по последним паттернам клиента",
      ],
    },
    {
      id: "after",
      label: "После сессии",
      emoji: "✅",
      color: "#1BAF7A",
      questions: [
        "Оформи конспект сессии",
        "Повторяющиеся темы за последние 3 месяца",
        "Резюме для супервизии по сложному случаю",
      ],
    },
  ];

  type Chart = { type: "bars"; data: { label: string; value: number }[] } | { type: "metrics"; items: { label: string; value: string }[] };

  const answers: Record<string, { text: string; chart?: Chart }> = {
    "Динамика по клиенту за последние 4 сессии": {
      text: "Тревожность по GAD-7 снижается стабильно: 14 → 11 → 9 → 7 баллов за 4 сессии. Основной сдвиг — после введения экспозиционных упражнений на 2-й сессии. Сон и концентрация внимания клиент отмечает как «заметно лучше» с 3-й сессии.",
      chart: { type: "bars", data: [{ label: "С1", value: 14 }, { label: "С2", value: 11 }, { label: "С3", value: 9 }, { label: "С4", value: 7 }] },
    },
    "На чём мы остановились в прошлый раз": {
      text: "Разбирали трудности с делегированием задач в команде — клиент старается сделать всё сам, потому что «так надёжнее». Наметили эксперимент: делегировать одну небольшую задачу коллеге и отследить тревогу по шкале от 1 до 10. Домашнее задание клиент выполнил на 4 из 5 дней.",
    },
    "Что из техник давало устойчивый результат": {
      text: "По истории сессий: дыхательная техника 4-7-8 перед стрессовыми встречами снизила субъективный уровень тревоги в 3 из 4 отмеченных случаев. Ведение дневника мыслей на регулярной основе коррелирует со снижением GAD-7 сильнее, чем разовые техники.",
      chart: { type: "metrics", items: [{ label: "Дыхание 4-7-8", value: "3/4 случаев" }, { label: "Дневник мыслей", value: "устойчиво ↓" }, { label: "Заземление 5-4-3-2-1", value: "разово" }] },
    },
    "Составь домашнее задание по КПТ на тревожность": {
      text: "Учитывая, что дневник мыслей уже показал эффект — предлагаю усложнить: дневник с колонкой «когнитивное искажение» на 7 дней, плюс одно запланированное экспозиционное упражнение средней сложности исходя из иерархии тревог с прошлой сессии.",
    },
    "Подбери методику для оценки уровня стресса": {
      text: "PSS-10 (шкала воспринимаемого стресса) подойдёт лучше GAD-7 в этом случае — клиент описывает скорее хроническую перегрузку, чем тревожные эпизоды. 10 вопросов, 5 минут, есть в базе методик платформы, результат сразу лёг в карточку клиента.",
    },
    "Сформулируй гипотезу по последним паттернам клиента": {
      text: "На основе 6 сессий вырисовывается паттерн: тревога делегирования усиливается именно в ситуациях с новыми или младшими сотрудниками. Стоит проверить гипотезу о связи с убеждением «если сделаю не я — будет хуже» — оно звучало явно или косвенно на четырёх сессиях.",
    },
    "Оформи конспект сессии": {
      text: "Конспект готов и сохранён в карточку клиента. Жалобы: тревожность перед встречами с руководством. Наблюдения: спокойная речь, открытая поза, среднее число пауз. Оценка: устойчивый прогресс в работе с перфекционизмом. План: продолжить экспозиционные техники, следующий тест — на уровень стресса.",
    },
    "Повторяющиеся темы за последние 3 месяца": {
      text: "Три доминирующие темы за 12 сессий: страх осуждения на работе — 9 упоминаний, сложности с делегированием — 6, повторяющиеся конфликты с партнёром по поводу быта — 5. Первая тема усиливается перед квартальными отчётами клиента — возможно, стоит спланировать сессию заранее.",
      chart: { type: "bars", data: [{ label: "Осуждение", value: 9 }, { label: "Делегирование", value: 6 }, { label: "Быт", value: 5 }] },
    },
    "Резюме для супервизии по сложному случаю": {
      text: "Клиент: 8 сессий, тревожное расстройство с элементами избегающего поведения. Прогресс: частота панических эпизодов снизилась с 3 до 1 раза в неделю, GAD-7 упал с 16 до 8. Вопрос для супервизии: стоит ли вводить экспозиционную терапию раньше запланированного срока — динамика опережает стандартный протокол на 2-3 сессии.",
    },
  };

  type ChatMsg = { role: "user" | "ai"; text: string; chart?: Chart; done?: boolean; color: string };

  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [customInput, setCustomInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const currentTab = tabs.find((t) => t.id === activeTab)!;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const askQuestion = (q: string) => {
    const color = currentTab.color;
    const answer = answers[q];
    const fullAnswer = answer?.text || "Уже смотрю в базе знаний и истории клиента — секунду, формулирую ответ на основе последних сессий.";
    const chart = answer?.chart;

    setMessages((prev) => [...prev, { role: "user", text: q, color }, { role: "ai", text: "", done: false, color }]);

    let i = 0;
    const interval = setInterval(() => {
      i += 3;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "ai") {
          const sliced = fullAnswer.slice(0, i);
          const isDone = sliced.length >= fullAnswer.length;
          next[next.length - 1] = { ...last, text: sliced, done: isDone, chart: isDone ? chart : undefined };
        }
        return next;
      });
      if (i >= fullAnswer.length) clearInterval(interval);
    }, 12);
  };

  return (
    <div
      style={{
        maxWidth: 1000,
        margin: "0 auto",
        background: "#FFFFFF",
        borderRadius: 20,
        border: "1px solid #E5DFD5",
        boxShadow: "0 20px 60px rgba(15,22,41,0.08)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        {/* Tabs sidebar */}
        <div
          style={{
            width: 220,
            flexShrink: 0,
            borderRight: "1px solid #E5DFD5",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
          className="ask-demo-tabs"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setMessages([]);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 10,
                border: "none",
                background: activeTab === tab.id ? `${tab.color}15` : "transparent",
                color: activeTab === tab.id ? tab.color : "#6B6058",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s",
                width: "100%",
              }}
            >
              <span style={{ fontSize: 16 }}>{tab.emoji}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 280, padding: 28, display: "flex", flexDirection: "column" }}>
          {/* Suggestion chips — always visible, switch with tab */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
            >
              {currentTab.questions.map((q) => (
                <button
                  key={q}
                  onClick={() => askQuestion(q)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "14px 16px",
                    borderRadius: 12,
                    border: "1.5px solid #E5DFD5",
                    background: "#FAFBFC",
                    color: "#1C1C1E",
                    fontSize: 13.5,
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  <span style={{ color: currentTab.color, flexShrink: 0, marginTop: 1 }}>✦</span>
                  {q}
                </button>
              ))}
            </motion.div>
          </AnimatePresence>

          {/* Chat history */}
          {messages.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                marginTop: 20,
                paddingTop: 20,
                borderTop: "1px solid #E5DFD5",
                maxHeight: 360,
                overflowY: "auto",
              }}
            >
              {messages.map((msg, i) =>
                msg.role === "user" ? (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                      alignSelf: "flex-end",
                      maxWidth: "80%",
                      padding: "10px 14px",
                      borderRadius: "14px 14px 4px 14px",
                      background: msg.color,
                      color: "#fff",
                      fontSize: 13.5,
                      lineHeight: 1.5,
                    }}
                  >
                    {msg.text}
                  </motion.div>
                ) : (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                      alignSelf: "flex-start",
                      maxWidth: "85%",
                      display: "flex",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: msg.color,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        fontSize: 12,
                        marginTop: 2,
                      }}
                    >
                      <motion.span
                        animate={{ opacity: [1, 0.4, 1] }}
                        transition={{ duration: 1, repeat: !msg.done ? Infinity : 0 }}
                        style={{ color: "#fff" }}
                      >
                        ✦
                      </motion.span>
                    </div>
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: "14px 14px 14px 4px",
                        background: `${msg.color}0A`,
                        border: `1px solid ${msg.color}30`,
                        fontSize: 13.5,
                        lineHeight: 1.5,
                        color: "#1C1C1E",
                      }}
                    >
                      {msg.text}
                      {!msg.done && (
                        <motion.span
                          animate={{ opacity: [1, 0] }}
                          transition={{ duration: 0.5, repeat: Infinity }}
                        >
                          ▍
                        </motion.span>
                      )}

                      {msg.chart && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          style={{ marginTop: 12 }}
                        >
                          {msg.chart.type === "bars" && (
                            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 70, padding: "0 4px" }}>
                              {msg.chart.data.map((bar, bi) => {
                                const max = Math.max(...(msg.chart as any).data.map((d: any) => d.value));
                                return (
                                  <div key={bi} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
                                    <motion.div
                                      initial={{ height: 0 }}
                                      animate={{ height: `${(bar.value / max) * 48}px` }}
                                      transition={{ duration: 0.6, delay: bi * 0.08, ease: "easeOut" }}
                                      style={{ width: "100%", maxWidth: 28, background: msg.color, borderRadius: 4, minHeight: 4 }}
                                    />
                                    <span style={{ fontSize: 10.5, color: "#6B6058", fontWeight: 600 }}>{bar.value}</span>
                                    <span style={{ fontSize: 9.5, color: "#8C7355" }}>{bar.label}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {msg.chart.type === "metrics" && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {msg.chart.items.map((item, mi) => (
                                <div
                                  key={mi}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "6px 10px",
                                    borderRadius: 8,
                                    background: "#FFFFFF",
                                    border: `1px solid ${msg.color}25`,
                                    fontSize: 12,
                                  }}
                                >
                                  <span style={{ color: "#6B6058" }}>{item.label}</span>
                                  <span style={{ color: msg.color, fontWeight: 700 }}>{item.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                )
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          {/* Custom input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customInput.trim()) {
                askQuestion(customInput.trim());
                setCustomInput("");
              }
            }}
            style={{ display: "flex", gap: 10, marginTop: 20 }}
          >
            <input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="Или задайте любой свой вопрос..."
              className="ask-demo-input"
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 10,
                border: "1.5px solid #E5DFD5",
                background: "#FFFFFF",
                color: "#1C1C1E",
                fontSize: 13.5,
                outline: "none",
              }}
            />
            <button
              type="submit"
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                border: "none",
                background: "#2D6A5C",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              →
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// Слайдер отзывов — по мотивам шаблона Tilda "Психотерапевт"
type Testimonial = { name: string; role: string; rating: number; text: string; avatar: string; color: string };

function TestimonialsSlider({ testimonials }: { testimonials: Testimonial[] }) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [paused, setPaused] = useState(false);

  const go = (dir: number) => {
    setDirection(dir);
    setIndex((prev) => (prev + dir + testimonials.length) % testimonials.length);
  };

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      setDirection(1);
      setIndex((prev) => (prev + 1) % testimonials.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [paused, testimonials.length]);

  const current = testimonials[index];

  return (
    <div
      style={{
        maxWidth: 860,
        margin: "0 auto",
        background: "#FFFFFF",
        border: "1px solid #E5DFD5",
        boxShadow: "0 20px 60px rgba(15,22,41,0.06)",
        borderRadius: 24,
        padding: "56px 64px",
        position: "relative",
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Nav arrows */}
      <button
        onClick={() => go(-1)}
        aria-label="Предыдущий отзыв"
        style={{
          position: "absolute",
          left: 16,
          top: "50%",
          transform: "translateY(-50%)",
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "none",
          background: "#2D6A5C",
          color: "#fff",
          fontSize: 18,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ←
      </button>
      <button
        onClick={() => go(1)}
        aria-label="Следующий отзыв"
        style={{
          position: "absolute",
          right: 16,
          top: "50%",
          transform: "translateY(-50%)",
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "none",
          background: "#2D6A5C",
          color: "#fff",
          fontSize: 18,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        →
      </button>

      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={index}
          custom={direction}
          initial={{ opacity: 0, x: direction > 0 ? 40 : -40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction > 0 ? -40 : 40 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 32,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              width: 100,
              height: 100,
              borderRadius: "50%",
              background: current.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 32,
              fontWeight: 700,
              flexShrink: 0,
              margin: "0 auto",
            }}
          >
            {current.avatar}
          </div>

          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: "flex", gap: 3, marginBottom: 14 }}>
              {[...Array(current.rating)].map((_, j) => (
                <span key={j} style={{ color: "#F59E0B", fontSize: 16 }}>★</span>
              ))}
            </div>
            <p style={{ fontSize: 18, color: "#1C1C1E", lineHeight: 1.7, marginBottom: 20 }}>
              «{current.text}»
            </p>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E" }}>{current.name}</div>
            <div style={{ fontSize: 13, color: "#8C7355" }}>{current.role}</div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Dots */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 36 }}>
        {testimonials.map((_, i) => (
          <button
            key={i}
            onClick={() => {
              setDirection(i > index ? 1 : -1);
              setIndex(i);
            }}
            aria-label={`Отзыв ${i + 1}`}
            style={{
              width: i === index ? 22 : 8,
              height: 8,
              borderRadius: 4,
              border: "none",
              background: i === index ? "#2D6A5C" : "#D5DAE3",
              cursor: "pointer",
              transition: "all 0.25s",
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// Продуктовый визуал для hero — блоб + плавающие UI-карточки (без фото, по мотивам upheal.io)
function HeroProductVisual() {
  const [stage, setStage] = useState(0); // 0: пишем протокол, 1: готово + проверено, 2: вопрос ассистенту

  useEffect(() => {
    const timer = setInterval(() => {
      setStage((s) => (s + 1) % 3);
    }, 2600);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 480, height: 540, margin: "0 auto", padding: "20px 12px" }}>
      {/* Фото психолога — реальный человек за продуктом, вместо абстрактной формы */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8 }}
        style={{
          position: "absolute",
          top: 20,
          left: 12,
          right: 12,
          bottom: 20,
          borderRadius: "32px",
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(45,106,92,0.35)",
        }}
      >
        <img
          src="/images/psychologist-hero.png"
          alt="Психолог работает в платформе ТОЛК"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center 20%",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse 70% 55% at 88% 100%, rgba(20,46,40,0.65) 0%, rgba(20,46,40,0) 65%)",
          }}
        />
      </motion.div>

      {/* Плавающие частицы */}
      {[
        { top: "8%", left: "14%", size: 5 },
        { top: "90%", left: "78%", size: 4 },
      ].map((p, i) => (
        <motion.div
          key={i}
          animate={{ y: [0, -10, 0], opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 3 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
          style={{
            position: "absolute",
            top: p.top,
            left: p.left,
            width: p.size * 2,
            height: p.size * 2,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.5)",
          }}
        />
      ))}

      {/* Карточки — компактный overlay в правом нижнем углу, не закрывает фигуру на фото */}
      <div
        style={{
          position: "absolute",
          right: 8,
          bottom: 32,
          width: "58%",
          maxWidth: 250,
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 0,
        }}
      >
        {/* Карточка 1: протокол сессии клиента Анны */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          style={{
            width: "100%",
            background: "#FFFFFF",
            borderRadius: 12,
            padding: 12,
            boxShadow: "0 20px 50px rgba(15,22,41,0.18)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "#1C1C1E" }}>Протокол</div>
            <AnimatePresence mode="wait">
              {stage === 0 ? (
                <motion.span
                  key="writing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{ fontSize: 9.5, color: "#8C7355", display: "flex", alignItems: "center", gap: 3 }}
                >
                  <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.9, repeat: Infinity }}>●</motion.span>
                  пишем
                </motion.span>
              ) : (
                <motion.span
                  key="done"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: "#1BAF7A",
                    background: "#E9FBF3",
                    padding: "2px 7px",
                    borderRadius: 10,
                  }}
                >
                  ✓ готово
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          {[100, stage === 0 ? 40 : 70, stage === 0 ? 0 : 60].map((w, i) => (
            <motion.div
              key={i}
              animate={{ width: `${w}%`, opacity: w === 0 ? 0 : 1 }}
              transition={{ duration: 0.5 }}
              style={{ height: 5, background: "#F0F2F6", borderRadius: 3, marginBottom: 6 }}
            />
          ))}
        </motion.div>

        {/* Карточка 2: вопрос ассистенту по тому же клиенту */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          style={{
            width: "100%",
            marginTop: 8,
            background: "#FFFFFF",
            borderRadius: 12,
            padding: 12,
            boxShadow: "0 20px 60px rgba(15,22,41,0.2)",
          }}
        >
          <div
            style={{
              background: "#F0F4FF",
              color: "#1C1C1E",
              padding: "6px 10px",
              borderRadius: "10px 10px 4px 10px",
              fontSize: 10,
              marginBottom: 7,
              maxWidth: "90%",
              marginLeft: "auto",
              lineHeight: 1.35,
            }}
          >
            Как менялась тревога у Марины за 3 сессии?
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, color: "#8B5CF6", fontSize: 9.5, fontWeight: 700, marginBottom: 4 }}>
            <span>✦</span> Ассистент
          </div>
          <AnimatePresence mode="wait">
            {stage === 2 ? (
              <motion.div
                key="answer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ fontSize: 10.5, color: "#6B6058", lineHeight: 1.4 }}
              >
                16 → 12 → 8 баллов по GAD-7
              </motion.div>
            ) : (
              <motion.div
                key="typing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ display: "flex", gap: 4 }}
              >
                {[0, 0.15, 0.3].map((delay, i) => (
                  <motion.span
                    key={i}
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 0.7, repeat: Infinity, delay }}
                    style={{ width: 5, height: 5, borderRadius: "50%", background: "#C7CEDB", display: "inline-block" }}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

// Абстрактный "сгенерированный" арт для hero — органические формы + нейросетевые узлы
const HeroGenerativeArt = () => (
  <svg
    width="560"
    height="520"
    viewBox="0 0 560 520"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ position: "absolute", right: 0, top: 0, opacity: 0.85 }}
  >
    <motion.path
      d="M420 60C480 90 500 160 470 220C440 280 500 320 480 380C460 440 380 460 330 430C280 400 250 440 200 420C150 400 130 340 160 290C190 240 150 190 190 140C230 90 360 30 420 60Z"
      stroke="#2D6A5C" strokeOpacity="0.18" strokeWidth="2.5" fill="none"
      animate={{ d: [
        "M420 60C480 90 500 160 470 220C440 280 500 320 480 380C460 440 380 460 330 430C280 400 250 440 200 420C150 400 130 340 160 290C190 240 150 190 190 140C230 90 360 30 420 60Z",
        "M430 70C490 100 490 170 460 230C430 290 510 310 490 370C470 430 370 470 320 440C270 410 260 450 210 430C160 410 120 330 150 280C180 230 140 200 180 150C220 100 370 40 430 70Z",
        "M420 60C480 90 500 160 470 220C440 280 500 320 480 380C460 440 380 460 330 430C280 400 250 440 200 420C150 400 130 340 160 290C190 240 150 190 190 140C230 90 360 30 420 60Z",
      ] }}
      transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
    />
    <motion.path
      d="M480 380C460 440 380 460 330 430"
      stroke="#1BAF7A" strokeOpacity="0.25" strokeWidth="3" fill="none" strokeLinecap="round"
      animate={{ opacity: [0.15, 0.4, 0.15] }}
      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
    />

    {/* Узлы нейросети со связями */}
    {[
      { x: 220, y: 130 }, { x: 340, y: 100 }, { x: 440, y: 170 },
      { x: 300, y: 230 }, { x: 420, y: 300 }, { x: 250, y: 340 },
      { x: 380, y: 400 },
    ].map((n, i, arr) => (
      <g key={i}>
        {i < arr.length - 1 && (
          <motion.line
            x1={n.x} y1={n.y} x2={arr[i + 1].x} y2={arr[i + 1].y}
            stroke="#8B5CF6" strokeOpacity="0.2" strokeWidth="1.5"
            animate={{ strokeOpacity: [0.08, 0.25, 0.08] }}
            transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.3 }}
          />
        )}
        <motion.circle
          cx={n.x} cy={n.y} r="4" fill="#2D6A5C"
          animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.3, 1] }}
          transition={{ duration: 2, repeat: Infinity, delay: i * 0.25, ease: "easeInOut" }}
        />
      </g>
    ))}
  </svg>
);

// Декоративная line-art сцена — уютный кабинет психолога, для секций страницы
const CozyOfficeArt = () => (
  <svg
    width="420"
    height="400"
    viewBox="0 0 520 480"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ opacity: 0.9 }}
  >
    {/* Окно с мягким светом */}
    <rect x="330" y="30" width="160" height="200" rx="8" stroke="#2D6A5C" strokeOpacity="0.25" strokeWidth="2"/>
    <line x1="410" y1="30" x2="410" y2="230" stroke="#2D6A5C" strokeOpacity="0.25" strokeWidth="2"/>
    <line x1="330" y1="130" x2="490" y2="130" stroke="#2D6A5C" strokeOpacity="0.25" strokeWidth="2"/>

    {/* Кресло */}
    <path
      d="M60 300C60 280 75 265 95 265H165C185 265 200 280 200 300V360H60V300Z"
      stroke="#1BAF7A" strokeOpacity="0.35" strokeWidth="2.5" strokeLinejoin="round"
    />
    <path d="M60 360V420M200 360V420" stroke="#1BAF7A" strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M45 300C45 290 52 282 62 282" stroke="#1BAF7A" strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M215 300C215 290 208 282 198 282" stroke="#1BAF7A" strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M40 300V340M220 300V340" stroke="#1BAF7A" strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round"/>

    {/* Растение в горшке */}
    <path d="M270 380L260 340M270 380L280 335M270 380L250 350M270 380L292 348"
      stroke="#1BAF7A" strokeOpacity="0.4" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M250 380H290L285 420H255L250 380Z" stroke="#F59E0B" strokeOpacity="0.35" strokeWidth="2.5" strokeLinejoin="round"/>

    {/* Книжная полка */}
    <line x1="330" y1="280" x2="480" y2="280" stroke="#8B5CF6" strokeOpacity="0.3" strokeWidth="2.5" strokeLinecap="round"/>
    {[0, 1, 2, 3, 4].map((i) => (
      <rect key={i} x={340 + i * 27} y="245" width="20" height="35" rx="2" stroke="#8B5CF6" strokeOpacity="0.3" strokeWidth="2"/>
    ))}

    {/* Мягкий коврик-эллипс */}
    <ellipse cx="150" cy="440" rx="140" ry="14" stroke="#2D6A5C" strokeOpacity="0.15" strokeWidth="2"/>
  </svg>
);

// Line-art — раскрытый блокнот с записями (для секции "Как работает")
// Line-art — звуковая волна перетекает в готовый документ (тема "от сессии к SOAP")
const WorkflowArt = () => {
  const bars = [14, 24, 18, 32, 20, 38, 16, 28, 22, 12];
  return (
    <svg width="380" height="320" viewBox="0 0 380 320" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.85 }}>
      {/* Звуковая волна слева */}
      {bars.map((h, i) => (
        <motion.rect
          key={i}
          x={20 + i * 16}
          width="7"
          rx="3.5"
          fill="none"
          stroke="#2D6A5C"
          strokeOpacity="0.35"
          strokeWidth="2"
          initial={{ height: h * 0.4, y: 160 - (h * 0.4) / 2 }}
          animate={{ height: [h * 0.4, h, h * 0.4], y: [160 - (h * 0.4) / 2, 160 - h / 2, 160 - (h * 0.4) / 2] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.1 }}
        />
      ))}

      {/* Стрелка перехода */}
      <motion.path
        d="M210 160H260"
        stroke="#8B5CF6" strokeOpacity="0.4" strokeWidth="2.5" strokeLinecap="round" fill="none"
        animate={{ opacity: [0.2, 0.6, 0.2] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      />
      <path d="M250 150L262 160L250 170" stroke="#8B5CF6" strokeOpacity="0.4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>

      {/* Готовый документ справа */}
      <path d="M280 90H340L360 110V230H280V90Z" stroke="#1BAF7A" strokeOpacity="0.3" strokeWidth="2.5" strokeLinejoin="round"/>
      <path d="M340 90V110H360" stroke="#1BAF7A" strokeOpacity="0.3" strokeWidth="2.5" strokeLinejoin="round"/>
      {[135, 155, 175, 195].map((y, i) => (
        <line key={i} x1="292" y1={y} x2={348 - i * 10} y2={y} stroke="#1BAF7A" strokeOpacity="0.3" strokeWidth="2" strokeLinecap="round"/>
      ))}
      <motion.path
        d="M292 210L306 222L340 190"
        stroke="#F59E0B" strokeOpacity="0.5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: [0, 1, 1, 0] }}
        transition={{ duration: 3, repeat: Infinity, times: [0, 0.4, 0.8, 1] }}
      />
    </svg>
  );
};

// Odometer-эффект: анимированный счётчик числовой части статистики (например "20 ч" -> считает 0..20)
function AnimatedStat({ value }: { value: string }) {
  const match = value.match(/(\d+(?:[.,]\d+)?)/);
  const numeric = match ? parseFloat(match[1].replace(",", ".")) : null;
  const prefix = match ? value.slice(0, match.index) : "";
  const suffix = match ? value.slice((match.index || 0) + match[1].length) : value;

  const [display, setDisplay] = useState(numeric === null ? value : "0");
  const ref = useRef<HTMLSpanElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (numeric === null || started) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          const duration = 2600;
          const startTime = performance.now();
          const isDecimal = numeric % 1 !== 0;
          const step = (now: number) => {
            const progress = Math.min((now - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 2);
            const current = numeric * eased;
            setDisplay(isDecimal ? current.toFixed(1) : Math.round(current).toString());
            if (progress < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [numeric, started]);

  return (
    <span ref={ref}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

// Визуальные бейджи доверия — 152-ФЗ, серверы РФ, шифрование
function TrustBadges() {
  const badges = [
    { icon: "🇷🇺", title: "Серверы в РФ", desc: "Без VPN и иностранных сервисов" },
    { icon: "🛡️", title: "152-ФЗ", desc: "Соответствие по умолчанию" },
    { icon: "🔒", title: "Шифрование", desc: "Данные защищены в реальном времени" },
  ];
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        gap: 16,
        flexWrap: "wrap",
        marginTop: 40,
      }}
    >
      {badges.map((b, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 18px",
            background: "#FFFFFF",
            border: "1px solid #E5DFD5",
            borderRadius: 12,
            boxShadow: "0 4px 16px rgba(15,22,41,0.05)",
          }}
        >
          <span style={{ fontSize: 20 }}>{b.icon}</span>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1C1C1E" }}>{b.title}</div>
            <div style={{ fontSize: 11, color: "#8C7355" }}>{b.desc}</div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// Line-art — весы (тема "честная цена", для секции тарифов)
const ScalesArt = () => (
  <svg width="300" height="320" viewBox="0 0 300 320" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.8 }}>
    <line x1="150" y1="40" x2="150" y2="260" stroke="#F59E0B" strokeOpacity="0.3" strokeWidth="3" strokeLinecap="round"/>
    <line x1="70" y1="70" x2="230" y2="70" stroke="#F59E0B" strokeOpacity="0.3" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M110 260H190" stroke="#F59E0B" strokeOpacity="0.3" strokeWidth="3" strokeLinecap="round"/>
    <path d="M120 280H180" stroke="#F59E0B" strokeOpacity="0.3" strokeWidth="3" strokeLinecap="round"/>

    {/* Левая чаша */}
    <motion.g
      animate={{ y: [0, 8, 0] }}
      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
    >
      <line x1="70" y1="70" x2="45" y2="130" stroke="#F59E0B" strokeOpacity="0.3" strokeWidth="2"/>
      <line x1="70" y1="70" x2="95" y2="130" stroke="#F59E0B" strokeOpacity="0.3" strokeWidth="2"/>
      <path d="M40 130C40 148 55 160 70 160C85 160 100 148 100 130" stroke="#2D6A5C" strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round"/>
    </motion.g>

    {/* Правая чаша */}
    <motion.g
      animate={{ y: [8, 0, 8] }}
      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
    >
      <line x1="230" y1="70" x2="205" y2="130" stroke="#F59E0B" strokeOpacity="0.3" strokeWidth="2"/>
      <line x1="230" y1="70" x2="255" y2="130" stroke="#F59E0B" strokeOpacity="0.3" strokeWidth="2"/>
      <path d="M200 130C200 148 215 160 230 160C245 160 260 148 260 130" stroke="#1BAF7A" strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round"/>
    </motion.g>

    <path d="M140 42L150 30L160 42" stroke="#F59E0B" strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Line-art — чашка чая/кофе с паром (для CTA/финальных секций)
const CupArt = ({ light = false }: { light?: boolean }) => {
  const stroke = light ? "#FFFFFF" : "#F59E0B";
  const steamStroke = light ? "#FFFFFF" : "#2D6A5C";
  return (
    <svg width="220" height="220" viewBox="0 0 220 220" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: light ? 0.35 : 0.85 }}>
      <path d="M50 90H150V140C150 165 130 185 100 185C70 185 50 165 50 140V90Z" stroke={stroke} strokeOpacity="0.3" strokeWidth="2.5" strokeLinejoin="round"/>
      <path d="M150 100H165C175 100 182 108 182 118C182 128 175 136 165 136H150" stroke={stroke} strokeOpacity="0.3" strokeWidth="2.5"/>
      <ellipse cx="100" cy="90" rx="50" ry="10" stroke={stroke} strokeOpacity="0.3" strokeWidth="2.5"/>
      {[75, 100, 125].map((x, i) => (
        <motion.path
          key={i}
          d={`M${x} 60C${x - 8} 48 ${x + 8} 40 ${x} 28`}
          stroke={steamStroke} strokeOpacity="0.3" strokeWidth="2" strokeLinecap="round" fill="none"
          animate={{ opacity: [0.15, 0.4, 0.15], y: [0, -4, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.4, ease: "easeInOut" }}
        />
      ))}
    </svg>
  );
};

function BrowserChrome({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        borderRadius: 14,
        border: "1px solid #E5DFD5",
        boxShadow: "0 24px 60px rgba(28, 28, 30, 0.12)",
        overflow: "hidden",
      }}
    >
      {/* Заголовок окна браузера */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          background: "#F5F3EF",
          borderBottom: "1px solid #E5DFD5",
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#E5A5A5" }} />
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#EAD08C" }} />
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#9FCBB0" }} />
        </div>
        <div
          style={{
            flex: 1,
            background: "#FFFFFF",
            border: "1px solid #E5DFD5",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 11,
            color: "#8C7355",
            textAlign: "center",
          }}
        >
          tolk.pro/{label}
        </div>
      </div>
      {children}
    </div>
  );
}

function PlatformScreens() {
  return (
    <div
      style={{
        position: "relative",
        maxWidth: 760,
        margin: "0 auto",
        paddingBottom: 56,
      }}
    >
      {/* Скриншот "Клиенты" — выглядывает слева сзади, крупнее чем раньше */}
      <motion.div
        initial={{ opacity: 0, x: -20, rotate: -4 }}
        whileInView={{ opacity: 1, x: 0, rotate: -4 }}
        transition={{ duration: 0.5 }}
        style={{
          position: "absolute",
          left: "-8%",
          bottom: -24,
          width: "50%",
          zIndex: 1,
          transform: "rotate(-4deg)",
        }}
      >
        <BrowserChrome label="clients">
          <img
            src="/images/screenshot-clients.png"
            alt="Список клиентов в ТОЛК"
            style={{ display: "block", width: "100%", height: "auto" }}
          />
        </BrowserChrome>
      </motion.div>

      {/* Скриншот "Прогресс" — выглядывает справа сзади, крупнее чем раньше */}
      <motion.div
        initial={{ opacity: 0, x: 20, rotate: 4 }}
        whileInView={{ opacity: 1, x: 0, rotate: 4 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        style={{
          position: "absolute",
          right: "-8%",
          bottom: -36,
          width: "48%",
          zIndex: 1,
          transform: "rotate(4deg)",
        }}
      >
        <BrowserChrome label="clients/progress">
          <div style={{ maxHeight: 320, overflow: "hidden" }}>
            <img
              src="/images/screenshot-progress.png"
              alt="Шкала прогресса клиента в ТОЛК"
              style={{ display: "block", width: "100%", height: "auto" }}
            />
          </div>
        </BrowserChrome>
      </motion.div>

      {/* Главный скриншот — дашборд, по центру сверху, компактнее чем раньше */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{
          position: "relative",
          zIndex: 2,
          width: "58%",
          margin: "0 auto",
        }}
      >
        <BrowserChrome label="dashboard">
          <img
            src="/images/screenshot-dashboard.png"
            alt="Главная страница личного кабинета ТОЛК"
            style={{ display: "block", width: "100%", height: "auto" }}
          />
        </BrowserChrome>
      </motion.div>
    </div>
  );
}

function HowItWorksInteractive() {
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      title: "Проведите сессию",
      desc: "Используйте встроенное видео, запишите аудио или добавьте заметки прямо в приложение",
      icon: <IconVoiceWaveform />,
      details: ["Поддержка видео и аудио", "Шифрование в реальном времени", "Автоматическое сохранение"],
    },
    {
      title: "Ассистент анализирует",
      desc: "Автоматически обрабатывает контент и извлекает ключевую информацию за 30 секунд",
      icon: <IconBrain />,
      details: ["Анализ тона и эмоций", "Выделение ключевых моментов", "Предложения для конспекта"],
    },
    {
      title: "Вы редактируете",
      desc: "Проверьте предложенную заметку и внесите правки. Система учится вашему стилю письма",
      icon: <IconPencil />,
      details: ["Одно нажатие на одобрение", "Быстрое редактирование", "История версий"],
    },
    {
      title: "Подпишите и готово",
      desc: "Экспортируйте в EHR или сохраните в архив. Всё архивируется автоматически на 5+ лет",
      icon: <IconCheckmark />,
      details: ["Экспорт в 10+ форматов", "Интеграция с EHR", "Облачное хранилище"],
    },
  ];

  // Автоматический свайп каждые 5 секунд
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % steps.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [steps.length]);

  const handleSwipe = (direction: "left" | "right") => {
    if (direction === "left" && currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else if (direction === "right" && currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      style={{
        padding: 40,
        background: "#FFFFFF",
        borderRadius: 16,
        border: "1px solid rgba(79, 126, 255, 0.2)",
        boxShadow: "0 8px 32px rgba(79, 126, 255, 0.1)",
      }}
    >
      {/* Progress Bar */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          {steps.map((_, i) => (
            <motion.button
              key={i}
              onClick={() => setCurrentStep(i)}
              whileHover={{ scale: 1.1 }}
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: i <= currentStep ? "#2D6A5C" : "#E5DFD5",
                border: "none",
                color: i <= currentStep ? "#fff" : "#8C7355",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                transition: "all 0.3s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {i + 1}
            </motion.button>
          ))}
        </div>

        {/* Connecting Line */}
        <div style={{ position: "relative", height: 4, background: "#E5DFD5", borderRadius: 2, overflow: "hidden" }}>
          <motion.div
            animate={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            style={{
              height: "100%",
              background: "linear-gradient(90deg, #2D6A5C 0%, #1BAF7A 100%)",
              borderRadius: 2,
            }}
          />
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          style={{
            textAlign: "center",
            marginBottom: 32,
          }}
        >
          <div style={{ marginBottom: 24, display: "flex", justifyContent: "center" }}>
            {steps[currentStep].icon}
          </div>
          <h3 style={{ fontSize: 24, fontWeight: 800, color: "#1C1C1E", marginBottom: 12, margin: 0 }}>
            {steps[currentStep].title}
          </h3>
          <p style={{ fontSize: 15, color: "#6B6058", marginBottom: 24, lineHeight: 1.6, maxWidth: 500, margin: "0 auto 24px" }}>
            {steps[currentStep].desc}
          </p>

          {/* Details */}
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap", marginBottom: 24 }}>
            {steps[currentStep].details.map((detail, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1 }}
                style={{
                  padding: "8px 16px",
                  background: "#E8F2EF",
                  color: "#2D6A5C",
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                ✓ {detail}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
        <button
          onClick={() => handleSwipe("right")}
          disabled={currentStep === 0}
          style={{
            padding: "10px 20px",
            background: currentStep === 0 ? "#E5DFD5" : "#F5F3EF",
            color: currentStep === 0 ? "#8C7355" : "#2D6A5C",
            border: "1px solid #E5DFD5",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: currentStep === 0 ? "not-allowed" : "pointer",
            transition: "all 0.2s",
          }}
        >
          ← Назад
        </button>

        {currentStep < steps.length - 1 ? (
          <button
            onClick={() => handleSwipe("left")}
            style={{
              padding: "10px 20px",
              background: "#2D6A5C",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#1F4E43")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#2D6A5C")}
          >
            Далее →
          </button>
        ) : (
          <button
            style={{
              padding: "10px 20px",
              background: "#1BAF7A",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#15966b")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#1BAF7A")}
          >
            Начать ✓
          </button>
        )}
      </div>

      {/* Step indicator */}
      <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "#8C7355" }}>
        Шаг {currentStep + 1} из {steps.length}
      </div>
    </motion.div>
  );
}

function ProgressionCard({ card, onBack }: { card: { title: string; details: string }; onBack: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.35 }}
      style={{
        background: "#2D6A5C",
        color: "#FFFFFF",
        padding: 32,
        borderRadius: 16,
        boxShadow: "0 20px 60px rgba(79, 126, 255, 0.3)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        height: 320,
        width: 300,
        border: "1px solid rgba(255, 255, 255, 0.2)",
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      <button
        onClick={onBack}
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          background: "rgba(255, 255, 255, 0.2)",
          border: "none",
          borderRadius: "50%",
          width: 28,
          height: 28,
          color: "#FFFFFF",
          cursor: "pointer",
          fontSize: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.2s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.4)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)")}
      >
        ✕
      </button>

      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 10px 0" }}>{card.title}</h3>
        <p style={{ fontSize: 11, lineHeight: 1.4, whiteSpace: "pre-wrap", margin: 0, opacity: 0.9 }}>
          {card.details}
        </p>
      </div>

      <button
        onClick={onBack}
        style={{
          background: "rgba(255, 255, 255, 0.1)",
          border: "1px solid rgba(255, 255, 255, 0.3)",
          color: "#FFFFFF",
          fontSize: 10,
          fontWeight: 600,
          cursor: "pointer",
          padding: "6px 12px",
          borderRadius: 6,
          transition: "all 0.2s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)";
          e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.5)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
          e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.3)";
        }}
      >
        ← Вернуться
      </button>
    </motion.div>
  );
}

function FeaturesCardStack({ featureId, cardIndex, onCardChange, onBack }: any) {
  const allFeatures = Object.values(FEATURES_DATA).flatMap(cat => cat.items);
  const currentFeature = allFeatures.find(f => f.id === featureId);

  const featureContent: Record<string, { details: string; howTo: string; pros: string }> = {
    "ai-notes": {
      details: "Пока вы работаете с клиентом, платформа фиксирует сессию и структурирует её содержание. Через 2 минуты после звонка — готовый конспект.",
      howTo: "1. Проведите сессию как обычно\n2. Платформа транскрибирует разговор\n3. Через 2 минуты конспект готов\n4. Редактируйте и экспортируйте в PDF или Word",
      pros: "✓ Конспект сессии без ручной работы\n✓ Экспорт в PDF и Word\n✓ 20 часов в месяц освобождается",
    },
    "ai-assistant": {
      details: "Не просто поиск по истории клиента — помощник, которому можно дать любую задачу: подобрать технику, сделать срез динамики, подготовить материал к супервизии.",
      howTo: "1. Задайте вопрос прямо во время сессии или после\n2. Ассистент использует историю клиента и вашу базу знаний\n3. Получите точный, а не шаблонный ответ\n4. Чем дольше работаете — тем умнее ассистент",
      pros: "✓ Ответы на основе вашей личной базы\n✓ Помощь прямо во время сессии\n✓ Срез динамики и черновики постов",
    },
    "ai-plan": {
      details: "Каждый конспект завершается планом на следующую встречу — что наметили обсудить дальше. Вы приходите на следующую сессию уже в полном контексте.",
      howTo: "1. После сессии конспект формируется автоматически\n2. В конце — план на следующую встречу\n3. При необходимости отредактируйте\n4. Используйте на следующей сессии без подготовки",
      pros: "✓ Не нужно вспоминать, о чём договорились\n✓ Терапия не теряет нить между сессиями\n✓ Всё под рукой перед следующей встречей",
    },
    "compliance": {
      details: "Видеосвязь и хранение данных — на российских серверах, без VPN и иностранных сервисов. Платформа соответствует 152-ФЗ по умолчанию.",
      howTo: "1. Все данные хранятся на серверах в РФ\n2. Видеозвонки — без VPN и блокировок\n3. Соответствие 152-ФЗ по умолчанию\n4. Дополнительных настроек не требуется",
      pros: "✓ Соответствие 152-ФЗ\n✓ Без VPN и ограничений по времени\n✓ Данные клиентов под защитой",
    },
    "scheduling": {
      details: "Достаточно поставить встречу в Google или Яндекс Календаре — платформа сама создаёт видеокомнату и отправляет клиенту ссылку с напоминанием.",
      howTo: "1. Поставьте встречу в своём календаре как обычно\n2. Платформа сама создаёт видеокомнату\n3. Клиенту приходит ссылка с напоминанием\n4. Вам не нужно делать ничего вручную",
      pros: "✓ Google и Яндекс Календарь\n✓ Автосоздание видеокомнаты\n✓ Напоминания клиенту без вашего участия",
    },
    "forms": {
      details: "Более 30 проверенных психологических тестов на тревожность, депрессию, стресс и другие состояния. Клиент проходит тест прямо в мессенджере.",
      howTo: "1. Выберите тест из встроенной базы\n2. Отправьте клиенту одним кликом\n3. Клиент проходит прямо в мессенджере\n4. Результаты с аналитикой приходят автоматически",
      pros: "✓ 30+ проверенных тестов\n✓ Прохождение без регистрации и приложений\n✓ Автоматическая аналитика результатов",
    },
    "portal": {
      details: "Отправить домашнее задание — один клик. Клиент получает его в своём мессенджере: Telegram или ВКонтакте — без регистрации.",
      howTo: "1. Откройте карточку клиента\n2. Выберите или создайте задание\n3. Отправьте одним кликом\n4. Система сама напомнит, если не выполнено",
      pros: "✓ Клиент получает без регистрации и приложений\n✓ Автоматические напоминания\n✓ Всё видно в карточке клиента",
    },
    "messaging": {
      details: "Клиенты пишут в свои привычные мессенджеры, вы отвечаете из одного окна платформы — без переключения между приложениями.",
      howTo: "1. Клиент пишет в свой обычный мессенджер\n2. Сообщение приходит в единый чат платформы\n3. Отвечайте из одного окна\n4. Не нужно переключаться между приложениями",
      pros: "✓ Telegram и ВКонтакте в одном чате\n✓ Клиенту не нужно ничего устанавливать\n✓ Вся переписка в одном месте",
    },
    "capture": {
      details: "Платформа фиксирует сессию и расшифровывает её с точным разделением: что говорили вы, что говорил клиент.",
      howTo: "1. Начните сессию на платформе\n2. Запись идёт автоматически в фоне\n3. Точное разделение реплик: вы и клиент\n4. Расшифровка используется для конспекта",
      pros: "✓ Ничего не нужно запускать вручную\n✓ Точное разделение реплик\n✓ Основа для конспекта сессии",
    },
    "telehealth": {
      details: "Видеозвонок прямо на платформе — российские серверы, без VPN, без иностранных сервисов, без ограничений по времени.",
      howTo: "1. Ссылка создаётся автоматически из календаря\n2. Клиент переходит по ссылке в браузере\n3. Экран разделён: клиент слева, заметки справа\n4. Всё происходит в одном окне браузера",
      pros: "✓ Без VPN и иностранных сервисов\n✓ Split-screen с заметками рядом\n✓ Без ограничений по времени звонка",
    },
    "apps": {
      details: "Ведите профессиональный дневник и наполняйте личную базу: техники, протоколы, статьи. Ассистент опирается на неё при подборе методов.",
      howTo: "1. Записывайте инсайты после сложных сессий\n2. Наполняйте базу: техники, протоколы, материалы\n3. Ассистент использует базу при подборе методов\n4. Готовьте вопросы для супервизии в одном месте",
      pros: "✓ Личная база вместо общих шаблонов\n✓ Ассистент учится на ваших материалах\n✓ Подготовка к супервизии в одном треке",
    },
    "payments": {
      details: "Система сама напоминает клиенту об оплате и отправляет ссылку через СБП. Если встреча не оплачена — ссылка на видеокомнату не откроется.",
      howTo: "1. Платформа сама напоминает клиенту об оплате\n2. Отправляется ссылка на оплату через СБП\n3. Встреча не оплачена — комната не откроется\n4. Никаких неловких разговоров про деньги",
      pros: "✓ Оплата через СБП\n✓ Автоматические напоминания\n✓ Контроль оплаты без вашего участия",
    },
    "insurance": {
      details: "Динамика тестовых показателей в виде графика, повторяющиеся темы и триггеры, паттерны поведения — по каждому клиенту отдельно.",
      howTo: "1. Ведите сессии на платформе как обычно\n2. Система анализирует данные автоматически\n3. Смотрите график динамики и паттерны\n4. Ассистент подсветит, если терапия уходит от плана",
      pros: "✓ График динамики по тестам\n✓ Повторяющиеся темы и триггеры\n✓ Раннее предупреждение об отклонении от плана",
    },
    "managed": {
      details: "Загрузка, финансовая картина, удержание клиентов и эффективность техник — вы видите свою практику целиком, а не отдельными фрагментами.",
      howTo: "1. Работайте в платформе как обычно\n2. Сессии и платежи фиксируются автоматически\n3. Откройте раздел аналитики практики\n4. Смотрите загрузку, финансы, удержание клиентов",
      pros: "✓ Вся практика видна целиком\n✓ Финансовая картина автоматически\n✓ Понимание, какие техники дают результат",
    },
  };

  if (!currentFeature) return null;

  const content = featureContent[featureId];

  const cardsToShow = [
    { title: currentFeature.name, details: content?.details || currentFeature.desc },
    { title: "Как начать", details: content?.howTo || "" },
    { title: "Плюсы", details: content?.pros || "" },
  ];

  const totalCards = cardsToShow.length;
  const hasMore = cardIndex < totalCards - 1;

  return (
    <div style={{ textAlign: "center", minHeight: 600 }}>
      <button
        onClick={onBack}
        style={{
          background: "none",
          border: "none",
          color: "#2D6A5C",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          textDecoration: "underline",
          marginBottom: 40,
          display: "block",
          margin: "0 auto 40px auto",
        }}
      >
        ← Назад к возможностям
      </button>

      {/* Three equal zones: left third / center third / right third, all vertically centered, same card size */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          alignItems: "center",
          minHeight: 360,
          width: "100%",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center" }}>
          <AnimatePresence mode="wait">
            {cardIndex === 0 && cardsToShow[0] && (
              <ProgressionCard key="card-0" card={cardsToShow[0]} onBack={onBack} />
            )}
          </AnimatePresence>
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <AnimatePresence mode="wait">
            {cardIndex === 1 && cardsToShow[1] && (
              <ProgressionCard key="card-1" card={cardsToShow[1]} onBack={onBack} />
            )}
          </AnimatePresence>
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <AnimatePresence mode="wait">
            {cardIndex === 2 && cardsToShow[2] && (
              <ProgressionCard key="card-2" card={cardsToShow[2]} onBack={onBack} />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Navigation with unusual animation */}
      <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 48, alignItems: "center" }}>
        <motion.button
          onClick={() => onCardChange(Math.max(0, cardIndex - 1))}
          disabled={cardIndex === 0}
          whileHover={cardIndex > 0 ? { scale: 1.15, rotate: -15 } : {}}
          whileTap={cardIndex > 0 ? { scale: 0.85 } : {}}
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            border: "none",
            background: cardIndex === 0 ? "#E5DFD5" : "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)",
            color: cardIndex === 0 ? "#8C7355" : "#FFFFFF",
            cursor: cardIndex === 0 ? "not-allowed" : "pointer",
            fontSize: 24,
            fontWeight: 700,
            boxShadow: cardIndex === 0 ? "none" : "0 8px 24px rgba(79, 126, 255, 0.3)",
            transition: "all 0.3s",
          }}
        >
          ←
        </motion.button>

        <div style={{ fontSize: 12, color: "#8C7355", fontWeight: 600 }}>
          {cardIndex + 1} / {totalCards}
        </div>

        <motion.button
          onClick={() => onCardChange(Math.min(totalCards - 1, cardIndex + 1))}
          disabled={!hasMore}
          whileHover={hasMore ? { scale: 1.15, rotate: 15 } : {}}
          whileTap={hasMore ? { scale: 0.85 } : {}}
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            border: "none",
            background: !hasMore ? "#E5DFD5" : "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)",
            color: !hasMore ? "#8C7355" : "#FFFFFF",
            cursor: !hasMore ? "not-allowed" : "pointer",
            fontSize: 24,
            fontWeight: 700,
            boxShadow: !hasMore ? "none" : "0 8px 24px rgba(79, 126, 255, 0.3)",
            transition: "all 0.3s",
          }}
        >
          →
        </motion.button>
      </div>
    </div>
  );
}

const FEATURES_DATA = {
  "Протокол и ассистент": {
    color: "#2D6A5C",
    items: [
      { id: "ai-notes", name: "Конспект сессии", desc: "Готовый протокол за 2 минуты вместо 40–60 минут вручную", icon: FileText, badge: "Популярное" as string | undefined },
      { id: "ai-assistant", name: "Личный ассистент", desc: "Знает историю клиента по всем сессиям и вашу базу знаний", icon: Bot, badge: undefined as string | undefined },
      { id: "ai-plan", name: "План на сессию", desc: "Подсказывает, что обсудить дальше — терапия не теряет нить", icon: ClipboardList, badge: undefined as string | undefined },
      { id: "compliance", name: "Российская защита", desc: "Серверы в РФ, без VPN, данные под защитой закона", icon: ShieldCheck, badge: undefined as string | undefined },
    ],
  },
  "Управление практикой": {
    color: "#1BAF7A",
    items: [
      { id: "scheduling", name: "Умный календарь", desc: "Google и Яндекс Календарь создают видеокомнату сами", icon: Calendar, badge: undefined as string | undefined },
      { id: "forms", name: "Тесты и опросники", desc: "30+ проверенных психологических тестов — отправляете в один клик", icon: ListChecks, badge: undefined as string | undefined },
      { id: "portal", name: "Домашние задания", desc: "Отправка в один клик, клиент получает в своём мессенджере", icon: Send, badge: undefined as string | undefined },
      { id: "messaging", name: "Единый чат", desc: "Telegram и ВКонтакте из одного окна платформы", icon: MessageSquare, badge: undefined as string | undefined },
    ],
  },
  "Видеосвязь и запись": {
    color: "#F59E0B",
    items: [
      { id: "capture", name: "Запись и расшифровка", desc: "Записывает сессию и точно разделяет, где вы, а где клиент", icon: Mic, badge: undefined as string | undefined },
      { id: "telehealth", name: "Видеосвязь", desc: "Российские серверы, без VPN, без ограничений по времени", icon: Video, badge: undefined as string | undefined },
      { id: "apps", name: "Дневник и база знаний", desc: "Личная база техник, на которую опирается ассистент", icon: BookOpen, badge: undefined as string | undefined },
    ],
  },
  "Оплата и аналитика": {
    color: "#8B5CF6",
    items: [
      { id: "payments", name: "Приём оплаты", desc: "Автонапоминание и ссылка на оплату через СБП", icon: CreditCard, badge: undefined as string | undefined },
      { id: "insurance", name: "Динамика клиента", desc: "Видно, как меняется состояние клиента от сессии к сессии", icon: TrendingUp, badge: undefined as string | undefined },
      { id: "managed", name: "Аналитика практики", desc: "Загрузка, финансы, удержание клиентов — в одном месте", icon: PieChart, badge: undefined as string | undefined },
    ],
  },
};

function AssistantChatSection() {
  const [messages, setMessages] = useState<Array<{ id: string; role: "user" | "assistant"; text: string }>>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: "1",
          role: "assistant",
          text: "Привет! Я помощник ТОЛК. Задай мне вопрос о работе с клиентом, анализе сессий или планировании. Вот примеры: 'Как работать с паническими атаками?' или 'Какие техники помогают при тревоге?'",
        },
      ]);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage = {
      id: Date.now().toString(),
      role: "user" as const,
      text: input,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    setTimeout(() => {
      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant" as const,
        text: "На основе данных тысячи психологов: самое важное в работе с этим запросом — это понимание триггеров клиента и постепенное введение техник совладания. ТОЛК помогает отследить динамику и подготовить рекомендации для клиента. Хотите узнать больше?",
      };
      setMessages(prev => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 1000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      style={{
        display: "flex",
        gap: 24,
        maxWidth: 1000,
        margin: "0 auto",
        alignItems: "stretch",
      }}
    >
      {/* Chat area */}
      <div
        style={{
          flex: 1,
          background: "#FFFFFF",
          borderRadius: 12,
          border: "1px solid #E5DFD5",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.08)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px",
            borderBottom: "1px solid #E5DFD5",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              background: "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <Sparkles size={16} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E" }}>
              ТОЛК Помощник
            </div>
            <div style={{ fontSize: 10, color: "#1BAF7A" }}>Всегда готов</div>
          </div>
        </div>

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 300,
          }}
        >
          {messages.map(msg => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                display: "flex",
                justifyContent: msg.role === "assistant" ? "flex-start" : "flex-end",
              }}
            >
              <div
                style={{
                  maxWidth: "85%",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: msg.role === "assistant" ? "#F5F3EF" : "#2D6A5C",
                  color: msg.role === "assistant" ? "#1C1C1E" : "#fff",
                  fontSize: 12,
                  lineHeight: "1.4",
                }}
              >
                {msg.text}
              </div>
            </motion.div>
          ))}
          {isLoading && (
            <div style={{ display: "flex", gap: 4 }}>
              <div
                style={{
                  width: 6,
                  height: 6,
                  background: "#8C7355",
                  borderRadius: "50%",
                  animation: "bounce 1.4s infinite",
                }}
              />
              <div
                style={{
                  width: 6,
                  height: 6,
                  background: "#8C7355",
                  borderRadius: "50%",
                  animation: "bounce 1.4s infinite",
                  animationDelay: "0.2s",
                }}
              />
              <div
                style={{
                  width: 6,
                  height: 6,
                  background: "#8C7355",
                  borderRadius: "50%",
                  animation: "bounce 1.4s infinite",
                  animationDelay: "0.4s",
                }}
              />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div
          style={{
            padding: "12px",
            borderTop: "1px solid #E5DFD5",
            display: "flex",
            gap: 6,
          }}
        >
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyPress={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Спросите меня..."
            style={{
              flex: 1,
              padding: "8px 12px",
              border: "1px solid #E5DFD5",
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "var(--font-sans)",
              color: "#1C1C1E",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading}
            style={{
              width: 32,
              height: 32,
              background: "#2D6A5C",
              border: "none",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: isLoading ? "not-allowed" : "pointer",
              color: "#fff",
              opacity: isLoading ? 0.6 : 1,
              transition: "all 0.2s",
            }}
          >
            <Send size={14} />
          </button>
        </div>

        <style>{`
          @keyframes bounce {
            0%, 80%, 100% {
              transform: translateY(0);
            }
            40% {
              transform: translateY(-8px);
            }
          }
        `}</style>
      </div>

      {/* Info column */}
      <div
        style={{
          flex: 0.8,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            padding: 20,
            background: "#FFFFFF",
            borderRadius: 12,
            border: "1px solid #E5DFD5",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#1C1C1E",
              marginBottom: 12,
            }}
          >
            Спросите о:
          </div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {[
              "Техниках КПТ и схема-терапии",
              "Домашних заданиях для клиентов",
              "Анализе прогресса",
              "Работе со сложными ситуациями",
            ].map((item, i) => (
              <li
                key={i}
                style={{
                  fontSize: 12,
                  color: "#6B6058",
                  display: "flex",
                  gap: 6,
                }}
              >
                <span style={{ color: "#1BAF7A" }}>✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div
          style={{
            padding: 20,
            background: "#F5F3EF",
            borderRadius: 12,
            border: "1px solid #E5DFD5",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#8C7355",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 8,
            }}
          >
            Факт
          </div>
          <p
            style={{
              fontSize: 12,
              color: "#6B6058",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            ТОЛК возвращает в среднем 20 часов в месяц — это 2.5 полных рабочих дня, освобождённых от рутины.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export default function LandingPage() {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [showFeaturesModal, setShowFeaturesModal] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [showFeaturesDropdown, setShowFeaturesDropdown] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);

  const features = [
    {
      icon: <IconAnimatedChat />,
      title: "Единый чат",
      desc: "Клиенты пишут в Telegram или ВКонтакте — вы отвечаете из одного окна платформы.",
      color: "#2D6A5C",
      benefits: ["TG + VK без приложения клиента", "Вся история в одном месте", "Без переключения между чатами"],
    },
    {
      icon: <IconAnimatedCalendar />,
      title: "Умный календарь",
      desc: "Поставьте встречу в Google или Яндекс Календаре — платформа сама создаёт видеокомнату и шлёт ссылку.",
      color: "#1BAF7A",
      benefits: ["Google и Яндекс Календарь", "Автосоздание видеокомнаты", "Напоминания клиенту без вашего участия"],
    },
    {
      icon: <IconAnimatedDocument />,
      title: "Конспект сессии",
      desc: "Система сама пишет структурированный конспект за 2 минуты вместо часа вручную. Вы редактируете и экспортируете.",
      color: "#F59E0B",
      benefits: ["20 часов в месяц освобождается", "Экспорт в PDF и Word", "Без ограничений на всех тарифах"],
    },
    {
      icon: <IconAnimatedAnalytics />,
      title: "Аналитика практики",
      desc: "Динамика тестов, повторяющиеся темы, загрузка и финансовая картина — практика видна целиком.",
      color: "#8B5CF6",
      benefits: ["График динамики по клиенту", "Раннее предупреждение об отклонении от плана", "Загрузка и удержание клиентов"],
    },
    {
      icon: <IconAnimatedPayment />,
      title: "Приём оплаты",
      desc: "Автонапоминание клиенту и ссылка на оплату через СБП. Без оплаты — видеокомната не откроется.",
      color: "#EC4899",
      benefits: ["Оплата через СБП", "Автоматические напоминания", "Без неловких разговоров про деньги"],
    },
    {
      icon: <IconAnimatedAssistant />,
      title: "Личный ассистент",
      desc: "Знает историю клиента по всем сессиям и вашу личную базу знаний. Спросите что угодно прямо во время сессии.",
      color: "#06B6D4",
      benefits: ["Ответы на основе вашей базы, а не шаблонов", "Помощь прямо во время сессии", "Срез динамики и подбор техник"],
    },
  ];

  const stats = [
    { number: "20 ч", label: "возвращается вам каждый месяц — это 2.5 рабочих дня" },
    { number: "2 мин", label: "на готовый анализ сессии вместо 40–60 минут вручную" },
    { number: "1 сессия", label: "окупает подписку на платформу целиком" },
    { number: "1 кабинет", label: "вместо семи разных инструментов" },
  ];

  const testimonials = [
    {
      name: "Мария Соколова",
      role: "Психолог, КПТ",
      rating: 5,
      text: "Раньше после каждой сессии уходило по 40–60 минут на конспект. Теперь он готов через 2 минуты — я только проверяю и редактирую. Освободилось около 20 часов в месяц.",
      avatar: "МС",
      color: "#2D6A5C",
    },
    {
      name: "Игорь Сидоров",
      role: "Супервизор, 20+ лет",
      rating: 5,
      text: "Использую режим «Супервизор» — все материалы по клиентам структурированы в одном треке, готовиться к разбору стало в разы быстрее.",
      avatar: "ИС",
      color: "#1BAF7A",
    },
    {
      name: "Елена Волкова",
      role: "Детский психолог",
      rating: 5,
      text: "Данные хранятся на российских серверах, соответствие 152-ФЗ — родители спокойны за конфиденциальность, я спокойна за практику.",
      avatar: "ЕВ",
      color: "#F59E0B",
    },
  ];

  const ambassadors = [
    {
      name: "Мария Соколова",
      initials: "МС",
      specialty: "КПТ, Схема-терапия",
      experience: "15+ лет",
      desc: "Специалист по тревожности, паническим атакам",
      clients: 25,
      rating: 4.9,
      color: "#2D6A5C",
    },
    {
      name: "Александр Петров",
      initials: "АП",
      specialty: "Семейная терапия",
      experience: "12+ лет",
      desc: "Разрешение семейных конфликтов, кризисы",
      clients: 18,
      rating: 4.8,
      color: "#1BAF7A",
    },
    {
      name: "Елена Волкова",
      initials: "ЕВ",
      specialty: "Детская психология",
      experience: "10+ лет",
      desc: "Работа с детьми 6-18 лет, родительское консультирование",
      clients: 30,
      rating: 5.0,
      color: "#F59E0B",
    },
    {
      name: "Дмитрий Морозов",
      initials: "ДМ",
      specialty: "Психодинамика",
      experience: "18+ лет",
      desc: "Личностное развитие, супервизия, сложные случаи",
      clients: 12,
      rating: 4.9,
      color: "#8B5CF6",
    },
  ];

  const faqItems = [
    {
      q: "Где хранятся данные клиентов и это законно?",
      a: "Данные хранятся на российских серверах, без VPN и иностранных сервисов. Платформа соответствует 152-ФЗ по умолчанию — никаких дополнительных настроек не требуется.",
    },
    {
      q: "Сколько времени я реально сэкономлю?",
      a: "По данным интервью с практикующими психологами, на рутину после сессий уходит от 15 до 25 часов в месяц. ТОЛК берёт эту рутину на себя — в среднем возвращается около 20 часов в месяц, это 2.5 полных рабочих дня.",
    },
    {
      q: "Чем вы лучше других похожих сервисов?",
      a: "У большинства аналогов функции ассистента работают на сгораемом балансе токенов — расходы непредсказуемы. В ТОЛК фиксированная подписка: протоколы и транскрибация без ограничений на всех тарифах, запросы к ассистенту — в рамках тарифа с видимым остатком.",
    },
    {
      q: "Клиенту нужно ставить какое-то приложение?",
      a: "Нет. Клиент получает сообщения, тесты и домашние задания в своём привычном мессенджере — Telegram или ВКонтакте, без регистрации и установки приложений. Вы отвечаете из одного окна платформы.",
    },
    {
      q: "Можно оплатить сразу на год и выйдет дешевле?",
      a: "Да, при годовой оплате действует скидка 17% (минус 2 месяца). Докупить дополнительные запросы к ассистенту можно в любой момент — пакет +100 запросов за 99 ₽.",
    },
    {
      q: "Не нашли ответ? Спросите помощника",
      a: "chat",
    },
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <div
      style={{
        background: "linear-gradient(180deg, #F5F3EF 0%, #F0EDE5 25%, #E8F2EF 50%, #F5F3EF 75%, #F0EDE5 100%)",
        minHeight: "100vh",
        overflowX: "clip",
      }}
    >
      {/* Header */}
      <style>{`
        header button:focus,
        header a:focus,
        header button:focus-visible,
        header a:focus-visible {
          outline: none !important;
          box-shadow: none !important;
        }
      `}</style>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: "rgba(45, 106, 92, 0.97)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          padding: "16px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          isolation: "isolate",
          outline: "none",
        }}
      >
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <Link
            href="/"
            onClick={(e) => {
              if (window.location.pathname === "/") {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", cursor: "pointer" }}
          >
            <LogoMark size={32} color="#FFFFFF" bubbleColor="#2D6A5C" />
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: "#FFFFFF", letterSpacing: "0.01em", lineHeight: 1 }}>ТОЛК</span>
              <span style={{ fontSize: 10, color: "rgba(255, 255, 255, 0.75)", letterSpacing: "0.02em", lineHeight: 1.2, marginTop: 2 }}>
                среда для психологов
              </span>
            </div>
          </Link>
        </motion.div>

        <nav
          style={{ display: "flex", gap: 36, fontSize: 13.5, alignItems: "center", letterSpacing: "0.01em" }}
        >
          <div
            style={{ position: "relative" }}
            onMouseEnter={() => setShowFeaturesDropdown(true)}
            onMouseLeave={() => setShowFeaturesDropdown(false)}
          >
            <button
              onClick={() => setShowFeaturesDropdown((v) => !v)}
              style={{
                background: "none",
                border: "none",
                outline: "none",
                boxShadow: "none",
                WebkitTapHighlightColor: "transparent",
                color: showFeaturesDropdown ? "#FFFFFF" : "rgba(255, 255, 255, 0.85)",
                fontSize: 13.5,
                fontWeight: 600,
                letterSpacing: "0.01em",
                cursor: "pointer",
                transition: "color 0.2s",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              Возможности
              <ChevronDown
                size={14}
                style={{
                  transform: showFeaturesDropdown ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                }}
              />
            </button>

            {typeof document !== "undefined" && createPortal(
              <AnimatePresence>
              {showFeaturesDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.15 }}
                  onMouseEnter={() => setShowFeaturesDropdown(true)}
                  onMouseLeave={() => setShowFeaturesDropdown(false)}
                  style={{
                    position: "fixed",
                    top: 110,
                    left: 24,
                    right: 24,
                    marginLeft: "auto",
                    marginRight: "auto",
                    background: "#FFFFFF",
                    borderRadius: 20,
                    boxShadow: "0 24px 80px rgba(15, 22, 41, 0.18)",
                    border: "1px solid #E5DFD5",
                    padding: 44,
                    maxWidth: 1180,
                    maxHeight: "calc(100vh - 140px)",
                    overflowY: "auto",
                    zIndex: 200,
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 36 }}>
                    {Object.entries(FEATURES_DATA).map(([category, { color, items }]) => (
                      <div key={category}>
                        <h4
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color,
                            marginBottom: 16,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {category}
                        </h4>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {items.map((feature) => {
                            const Icon = feature.icon;
                            return (
                              <button
                                key={feature.id}
                                onClick={() => {
                                  setShowFeaturesDropdown(false);
                                  setShowFeaturesModal(true);
                                  setSelectedFeature(feature.id);
                                  setCardIndex(0);
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 12,
                                  padding: "10px 8px",
                                  background: "none",
                                  border: "none",
                                  outline: "none",
                                  borderRadius: 10,
                                  textAlign: "left",
                                  cursor: "pointer",
                                  transition: "background 0.15s",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = "#F5F3EF")}
                                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                              >
                                <div
                                  style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 8,
                                    background: `${color}1A`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                  }}
                                >
                                  <Icon size={16} color={color} />
                                </div>
                                <div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E", lineHeight: 1.4 }}>
                                      {feature.name}
                                    </span>
                                    {feature.badge && (
                                      <span
                                        style={{
                                          fontSize: 9,
                                          fontWeight: 700,
                                          color,
                                          background: `${color}1A`,
                                          padding: "2px 6px",
                                          borderRadius: 10,
                                          textTransform: "uppercase",
                                          letterSpacing: "0.03em",
                                        }}
                                      >
                                        {feature.badge}
                                      </span>
                                    )}
                                  </div>
                                  <span style={{ fontSize: 12.5, color: "#6B6058", lineHeight: 1.5 }}>
                                    {feature.desc}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div
                    style={{
                      marginTop: 32,
                      paddingTop: 24,
                      borderTop: "1px solid #E5DFD5",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: 13, color: "#8C7355" }}>
                      Фиксированная подписка без сгораемых токенов
                    </span>
                    <Link
                      href="/login"
                      onClick={() => setShowFeaturesDropdown(false)}
                      style={{
                        color: "#2D6A5C",
                        textDecoration: "none",
                        fontSize: 13,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      Попробовать <ArrowRight size={14} />
                    </Link>
                  </div>
                </motion.div>
              )}
              </AnimatePresence>,
              document.body
            )}
          </div>
          {[
            { label: "Сравнение", href: "#comparison" },
            { label: "Как работает", href: "#howitworks" },
            { label: "Партнеры", href: "#ambassadors" },
            { label: "Цены", href: "#pricing" },
            { label: "Вопросы", href: "#faq" },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              style={{
                color: "rgba(255, 255, 255, 0.85)",
                textDecoration: "none",
                fontWeight: 600,
                letterSpacing: "0.01em",
                transition: "color 0.2s",
                outline: "none",
                WebkitTapHighlightColor: "transparent",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#FFFFFF")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255, 255, 255, 0.85)")}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href="/login"
            style={{
              padding: "10px 20px",
              background: "none",
              color: "#FFFFFF",
              border: "1px solid rgba(255, 255, 255, 0.3)",
              borderRadius: 8,
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 600,
              transition: "all 0.2s",
              outline: "none",
              WebkitTapHighlightColor: "transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#FFFFFF";
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.3)";
              e.currentTarget.style.background = "none";
            }}
          >
            Вход
          </Link>
          <Link
            href="/login?mode=register"
            style={{
              padding: "10px 20px",
              background: "#FFFFFF",
              color: "#2D6A5C",
              borderRadius: 8,
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 600,
              transition: "all 0.2s",
              outline: "none",
              WebkitTapHighlightColor: "transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#F0EDE5";
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#FFFFFF";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            Регистрация
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section
        style={{
          padding: "100px 24px",
          background: "linear-gradient(135deg, #E8F2EF 0%, #E6F7F2 100%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-50%",
            right: "-20%",
            width: "500px",
            height: "500px",
            background: "rgba(79, 126, 255, 0.1)",
            borderRadius: "50%",
            filter: "blur(40px)",
          }}
        />

        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            position: "relative",
            zIndex: 10,
            display: "grid",
            gridTemplateColumns: "minmax(280px, 560px) minmax(280px, 480px)",
            gap: 48,
            alignItems: "center",
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1
              style={{
                fontSize: 48,
                fontWeight: 800,
                color: "#1C1C1E",
                marginBottom: 20,
                lineHeight: 1.2,
              }}
            >
              <span style={{ color: "#2D6A5C" }}>20 часов в месяц</span> экономит психологам ТОЛК
            </h1>

            <p
              style={{
                fontSize: 18,
                color: "#6B6058",
                marginBottom: 32,
                lineHeight: 1.6,
              }}
            >
              <strong style={{ color: "#1C1C1E", fontWeight: 700 }}>Конспект сессии</strong>, карточка клиента, тесты и напоминания клиентам — платформа берёт это на себя, пока вы отдыхаете или ведёте следующую сессию.
            </p>

            <div style={{ display: "flex", gap: 16, marginBottom: 40, flexWrap: "wrap" }}>
              <Link
                href="/login?mode=register"
                style={{
                  padding: "16px 32px",
                  background: "#2D6A5C",
                  color: "#fff",
                  borderRadius: 8,
                  textDecoration: "none",
                  fontSize: 15,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#1F4E43";
                  e.currentTarget.style.transform = "translateY(-4px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#2D6A5C";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                Регистрация
              </Link>
              <button
                onClick={() => setShowDemoModal(true)}
                style={{
                  padding: "16px 32px",
                  background: "#FFFFFF",
                  color: "#2D6A5C",
                  border: "2px solid #E5DFD5",
                  borderRadius: 8,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#2D6A5C";
                  e.currentTarget.style.background = "#E8F2EF";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#E5DFD5";
                  e.currentTarget.style.background = "#FFFFFF";
                }}
              >
                <PlayCircle size={18} />
                Смотреть демо
              </button>
            </div>

            {/* Социальное доказательство */}
            <div style={{ display: "flex", gap: 24, fontSize: 13, color: "#6B6058", flexWrap: "wrap", marginBottom: 20 }}>
              {[
                "✓ Соответствие 152-ФЗ",
                "✓ Российские серверы, без VPN",
                "✓ Фиксированная подписка без сгораемых токенов",
                "✓ Поддержка на русском",
              ].map((item, i) => (
                <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.1 }}>
                  {item}
                </motion.div>
              ))}
            </div>

            {/* Партнёр */}
            <motion.a
              href="https://newpsy.org"
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "12px 18px",
                background: "#FFFFFF",
                border: "1px solid #E5DFD5",
                borderRadius: 12,
                maxWidth: 480,
                textDecoration: "none",
                transition: "border-color 0.2s, box-shadow 0.2s",
              }}
              whileHover={{ borderColor: "#2D6A5C", boxShadow: "0 4px 16px rgba(45,106,92,0.12)" }}
            >
              <span style={{ fontSize: 11, color: "#8C7355", flexShrink: 0 }}>Партнёр:</span>
              <img
                src="/images/newpsy-logo.png"
                alt="NEWPSY"
                style={{ height: 20, width: "auto", flexShrink: 0 }}
              />
              <span style={{ fontSize: 12, color: "#6B6058", lineHeight: 1.4 }}>
                эксклюзивный дистрибьютор PsychotherapyNet и программ по нейропсихоанализу Марка Солмса на русском
              </span>
            </motion.a>
          </motion.div>

          <HeroProductVisual />
        </div>
      </section>

      {/* Статистика */}
      <section style={{ padding: "60px 24px", background: "#FFFFFF", borderBottom: "1px solid #E5DFD5" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <motion.div
            initial="hidden"
            whileInView="visible"
            variants={containerVariants}
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 32 }}
          >
            {stats.map((stat, i) => (
              <motion.div key={i} variants={itemVariants} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 36, fontWeight: 800, color: "#2D6A5C", marginBottom: 8 }}>
                  <AnimatedStat value={stat.number} />
                </div>
                <div style={{ fontSize: 13, color: "#6B6058" }}>{stat.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Какой толк */}
      <section style={{ padding: "80px 24px", background: "#FFFFFF", borderBottom: "1px solid #E5DFD5" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#1C1C1E",
              textAlign: "center",
              marginBottom: 48,
            }}
          >
            Какой <span style={{ color: "#2D6A5C", fontStyle: "italic" }}>толк</span> работать с нами?
          </motion.h2>

          <motion.div
            initial="hidden"
            whileInView="visible"
            variants={containerVariants}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 24,
            }}
          >
            {[
              {
                title: "Экономия времени",
                desc: "От 15 до 25 часов в месяц уходит на рутину после сессий. ТОЛК возвращает вам около 20 часов — это 2.5 полных рабочих дня.",
                metric: "20 часов",
                metricDesc: "в месяц",
              },
              {
                title: "Всё в одном окне",
                desc: "Видеосвязь, чат из всех мессенджеров, протоколы, тесты, домашние задания, оплата, аналитика, дневник, база знаний — без переключений между сервисами.",
                metric: "1 кабинет",
                metricDesc: "вместо семи инструментов",
              },
              {
                title: "Качество работы",
                desc: "Когда не нужно вспоминать и восстанавливать контекст, вы приходите на сессию уже подготовленным — и полностью присутствуете с клиентом.",
                metric: "100%",
                metricDesc: "концентрация на клиенте",
              },
              {
                title: "Приём оплаты",
                desc: "Клиент оплачивает сессию прямо в кабинете — без переносов вручную и напоминаний «переведите, пожалуйста».",
                metric: "0",
                metricDesc: "ручных переводов",
              },
              {
                title: "Российская защита",
                desc: "Видеосвязь и хранение данных — на российских серверах, без VPN и иностранных сервисов. Соответствие 152-ФЗ по умолчанию.",
                metric: "152-ФЗ",
                metricDesc: "соответствие",
              },
              {
                title: "Окупается за сессию",
                desc: "Фиксированная подписка от 1 990 ₽ в месяц. Одна сессия окупает подписку на платформу целиком.",
                metric: "1 сессия",
                metricDesc: "окупает платформу",
              },
            ].map((item, i) => (
              <motion.div
                key={i}
                variants={itemVariants}
                whileHover={{ y: -8 }}
                style={{
                  padding: 28,
                  background: "#F5F3EF",
                  borderRadius: 12,
                  border: "1px solid #E5DFD5",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    marginBottom: 16,
                  }}
                >
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", margin: 0, flex: 1 }}>
                    {item.title}
                  </h3>
                  <div
                    style={{
                      textAlign: "right",
                      marginLeft: 16,
                      flexShrink: 0,
                    }}
                  >
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#2D6A5C" }}>
                      {item.metric}
                    </div>
                    <div style={{ fontSize: 11, color: "#8C7355" }}>{item.metricDesc}</div>
                  </div>
                </div>

                <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.6, margin: 0, flex: 1 }}>
                  {item.desc}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features - с табами */}
      <section id="features" style={{ padding: "80px 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#1C1C1E",
              textAlign: "center",
              marginBottom: 12,
            }}
          >
            Инструменты, которые действительно помогают
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              textAlign: "center",
              fontSize: 15,
              color: "#6B6058",
              marginBottom: 48,
            }}
          >
            Всё, что нужно для эффективной практики на одной платформе
          </motion.p>

          {/* Grid */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 24,
            }}
          >
            {features.map((feature, i) => (
              <motion.div
                key={i}
                variants={itemVariants}
                whileHover={{ y: -8, boxShadow: `0 20px 40px ${feature.color}30` }}
                style={{
                  padding: 28,
                  background: "#FFFFFF",
                  borderRadius: 12,
                  border: "1px solid #E5DFD5",
                  transition: "all 0.2s",
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    background: `${feature.color}20`,
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  {feature.icon}
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", marginBottom: 8 }}>
                  {feature.title}
                </h3>
                <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.6, margin: 0 }}>
                  {feature.desc}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How it works - Interactive */}
      <section
        id="howitworks"
        style={{
          padding: "80px 24px",
          background: "linear-gradient(135deg, #E8F2EF 0%, #E6F7F2 100%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", left: "-60px", top: "10px", zIndex: 0, pointerEvents: "none", opacity: 0.6 }}>
          <WorkflowArt />
        </div>
        <div style={{ maxWidth: 1000, margin: "0 auto", position: "relative", zIndex: 1 }}>
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#1C1C1E",
              textAlign: "center",
              marginBottom: 12,
            }}
          >
            От сессии к готовому конспекту за 5 минут
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              textAlign: "center",
              fontSize: 15,
              color: "#6B6058",
              marginBottom: 60,
            }}
          >
            Смотрите, как работает процесс (свайпните или кликните на шаги)
          </motion.p>

          {/* Progress Steps */}
          <HowItWorksInteractive />
        </div>
      </section>

      {/* Скриншоты платформы — заглянуть внутрь ЛК */}
      <section style={{ padding: "80px 24px", background: "#FFFFFF" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#1C1C1E",
              textAlign: "center",
              marginBottom: 12,
            }}
          >
            Загляните внутрь личного кабинета
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              textAlign: "center",
              fontSize: 15,
              color: "#6B6058",
              marginBottom: 48,
              maxWidth: 600,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Никакой путаницы — все клиенты, сессии и подсказки ассистента в одном спокойном интерфейсе.
          </motion.p>

          <PlatformScreens />
        </div>
      </section>

      {/* Ask Anything Demo */}
      <section style={{ padding: "80px 24px", background: "#FFFFFF" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#1C1C1E",
              textAlign: "center",
              marginBottom: 12,
            }}
          >
            Спросите что угодно — ассистент справится
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              textAlign: "center",
              fontSize: 15,
              color: "#6B6058",
              marginBottom: 40,
              maxWidth: 640,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            От подготовки к сессии до протокола после неё — просто спросите, и <strong style={{ color: "#1C1C1E" }}>ассистент, знающий историю клиента</strong>, сделает остальное. Попробуйте прямо здесь.
          </motion.p>

          <AskAnythingDemo />
        </div>
      </section>

      {/* Testimonials */}
      <section style={{ padding: "80px 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#1C1C1E",
              textAlign: "center",
              marginBottom: 48,
            }}
          >
            Что говорят настоящие пользователи
          </motion.h2>

          <TestimonialsSlider testimonials={testimonials} />
        </div>
      </section>

      {/* Ambassadors - расширенная версия */}
      <section id="ambassadors" style={{ padding: "80px 24px", background: "#FFFFFF", borderTop: "1px solid #E5DFD5", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: "0px", top: "0px", zIndex: 0, pointerEvents: "none", opacity: 0.55, transform: "scale(0.8)", transformOrigin: "top right" }}>
          <CozyOfficeArt />
        </div>
        <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative", zIndex: 1 }}>
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} style={{ marginBottom: 48 }}>
            <h2 style={{ fontSize: 36, fontWeight: 800, color: "#1C1C1E", marginBottom: 12 }}>
              <span style={{ color: "#1BAF7A" }}>Толковые</span> специалисты
            </h2>
            <p style={{ fontSize: 15, color: "#6B6058", maxWidth: 600 }}>
              Опытные и толковые психологи, избравшие ТОЛК. Они доступны для супервизии и консультаций через нашу платформу. Делимся опытом и помогаем расти вместе.
            </p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            variants={containerVariants}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 24,
              marginBottom: 40,
            }}
          >
            {ambassadors.map((amb, i) => (
              <motion.div
                key={i}
                variants={itemVariants}
                whileHover={{ y: -12 }}
                style={{
                  padding: 28,
                  background: "linear-gradient(135deg, #FFFFFF 0%, #F5F3EF 100%)",
                  borderRadius: 12,
                  border: `2px solid ${amb.color}30`,
                }}
              >
                {/* Header с аватаром */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
                  <div
                    style={{
                      width: 60,
                      height: 60,
                      background: amb.color,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: 20,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {amb.initials}
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", margin: "0 0 4px 0" }}>
                      {amb.name}
                    </h3>
                    <p style={{ fontSize: 12, color: amb.color, fontWeight: 600, margin: 0 }}>
                      {amb.specialty}
                    </p>
                  </div>
                </div>

                {/* Инфо */}
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginBottom: 16,
                    fontSize: 12,
                    color: "#6B6058",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: "#1C1C1E" }}>{amb.experience}</div>
                    <div>опыта</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: "#1C1C1E" }}>{amb.clients}</div>
                    <div>активных клиентов</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: amb.color }}>{amb.rating} ★</div>
                    <div>рейтинг</div>
                  </div>
                </div>

                <p style={{ fontSize: 13, color: "#6B6058", marginBottom: 20, lineHeight: 1.5 }}>
                  {amb.desc}
                </p>

                <button
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    background: amb.color,
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "0.9";
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "1";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  Запросить супервизию
                </button>
              </motion.div>
            ))}

            {/* Свободные места для новых амбассадоров */}
            {[0, 1].map((i) => (
              <motion.div
                key={`slot-${i}`}
                variants={itemVariants}
                whileHover={{ y: -12 }}
                style={{
                  padding: 28,
                  background: "#FAFBFC",
                  borderRadius: 12,
                  border: "2px dashed #C7CEDB",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  gap: 12,
                  minHeight: 260,
                }}
              >
                <div
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: "50%",
                    border: "2px dashed #C7CEDB",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    color: "#8C7355",
                  }}
                >
                  +
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E" }}>
                  Это место ждёт тебя
                </div>
                <p style={{ fontSize: 12.5, color: "#6B6058", lineHeight: 1.5, margin: 0 }}>
                  Станьте амбассадором ТОЛК: новые клиенты супервизии и комиссия 20% с каждого.
                </p>
                <button
                  style={{
                    padding: "10px 20px",
                    background: "#2D6A5C",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#1F4E43";
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#2D6A5C";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  Стать амбассадором
                </button>
              </motion.div>
            ))}
          </motion.div>

        </div>
      </section>

      {/* Why ТОЛК Section */}
      <section style={{ padding: "80px 24px", background: "#E8F2EF" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#1C1C1E",
              textAlign: "center",
              marginBottom: 48,
            }}
          >
            Почему психологи выбирают<span style={{ color: "#2D6A5C" }}> ТОЛК</span>
          </motion.h2>

          <motion.div
            initial="hidden"
            whileInView="visible"
            variants={containerVariants}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: 32,
            }}
          >
            {[
              {
                title: "Экономия времени",
                desc: "20 часов в месяц возвращается вам — анализ сессии готов за 2 минуты вместо часа ручной работы.",
                icon: <IconAnimatedClock />,
              },
              {
                title: "Ассистент на вашей стороне",
                desc: "Генерирует, анализирует и подсказывает — а финальное решение всегда остаётся за вами.",
                icon: <IconAnimatedBrain />,
              },
              {
                title: "Поддержка 24/7",
                desc: "Горячая линия на русском. Реальный человек отвечает за 5 минут. Без ботов и очередей.",
                icon: <IconAnimatedHandshake />,
              },
              {
                title: "Честная цена",
                desc: "Фиксированная подписка от 1 990 ₽ в месяц — без сгораемых токенов и непредсказуемых расходов, как у аналогов.",
                icon: <IconAnimatedCoin />,
              },
              {
                title: "Надёжная безопасность",
                desc: "Российские серверы, без VPN. Соответствие 152-ФЗ по умолчанию — данные клиентов под защитой.",
                icon: <IconAnimatedLock />,
              },
              {
                title: "Сообщество и мастер-классы",
                desc: "На тарифах Профессионал и Эксперт — доступ к сообществу психологов и мастер-классам.",
                icon: <IconAnimatedNetwork />,
              },
            ].map((item, i) => (
              <motion.div
                key={i}
                variants={itemVariants}
                whileHover={{ y: -8 }}
                style={{
                  padding: 28,
                  background: "#FFFFFF",
                  borderRadius: 12,
                  border: "1px solid #D0E0FF",
                }}
              >
                <div style={{ marginBottom: 12 }}>{item.icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", marginBottom: 8 }}>
                  {item.title}
                </h3>
                <p style={{ fontSize: 13, color: "#6B6058", lineHeight: 1.6, margin: 0 }}>
                  {item.desc}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Сравнение с конкурентами */}
      <section id="comparison" style={{ padding: "80px 24px", background: "#FFFFFF", borderTop: "1px solid #E5DFD5" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#1C1C1E",
              textAlign: "center",
              marginBottom: 48,
            }}
          >
            Чем ТОЛК отличается от других
          </motion.h2>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              textAlign: "center",
              fontSize: 14,
              color: "#6B6058",
              maxWidth: 720,
              margin: "0 auto 32px auto",
              lineHeight: 1.6,
            }}
          >
            У большинства аналогов функции ассистента работают на сгораемом балансе токенов — расходы непредсказуемы каждый месяц. В ТОЛК фиксированная подписка: протоколы и транскрибация без ограничений на всех тарифах.
          </motion.p>

          <div
            style={{
              overflowX: "auto",
              background: "#F5F3EF",
              borderRadius: 12,
              padding: 24,
            }}
          >
            <table style={{ width: "100%", minWidth: 640, fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #E5DFD5" }}>
                  <th style={{ textAlign: "left", padding: 12, fontWeight: 700, color: "#1C1C1E" }}>
                    Функция
                  </th>
                  <th style={{ textAlign: "center", padding: 12, fontWeight: 700, color: "#2D6A5C" }}>
                    ТОЛК
                  </th>
                  <th style={{ textAlign: "center", padding: 12, color: "#8C7355" }}>Аналог А</th>
                  <th style={{ textAlign: "center", padding: 12, color: "#8C7355" }}>Аналог Б</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Конспект сессии за 2 мин", "✓ авто", "✓ AI-мемо", "✓ резюме"],
                  ["Редактируемый протокол + PDF/Word", "✓", "✓", "✗"],
                  ["Экран: видео + заметки рядом", "✓ split-screen", "✗", "✗"],
                  ["Единый чат без приложения", "✓", "✗ приложение клиента", "✗"],
                  ["Ассистент знает историю клиента", "✓ по всем сессиям", "частично", "✗ общий"],
                  ["Автонапоминание + ссылка на оплату СБП", "✓", "✗", "✗"],
                  ["Умный календарь Google/Яндекс", "✓", "✓", "✗"],
                  ["Тесты (30+ методик)", "✓", "✓", "✓ 50+"],
                  ["Дневник рефлексии + база знаний с ассистентом", "✓", "✗", "✗"],
                  ["Аналитика практики в целом", "✓", "частично", "✗"],
                  ["Фиксированная цена без скрытых доплат", "✓ всё включено", "~ частично", "✗ + токены сверху"],
                ].map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #E5DFD5" }}>
                    <td style={{ padding: 12, color: "#1C1C1E", fontWeight: 500 }}>{row[0]}</td>
                    <td style={{ textAlign: "center", padding: 12, color: "#1BAF7A", fontWeight: 700 }}>
                      {row[1]}
                    </td>
                    <td style={{ textAlign: "center", padding: 12, color: "#8C7355" }}>{row[2]}</td>
                    <td style={{ textAlign: "center", padding: 12, color: "#8C7355" }}>{row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            style={{
              marginTop: 32,
              padding: 28,
              background: "#F5F3EF",
              borderRadius: 12,
              border: "1px solid #E5DFD5",
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1C1C1E", marginBottom: 10 }}>
              Персонализация — принципиальная разница
            </h3>
            <p style={{ fontSize: 13.5, color: "#6B6058", lineHeight: 1.6, marginBottom: 10 }}>
              У большинства аналогов ИИ-ассистента либо вообще нет, либо он работает как обычный чат-бот: он не знает ничего о вашем конкретном клиенте. Задаёте вопрос — получаете общий ответ из интернета. Это полезно, но это далеко не то же самое, что помощник, который работал с вашим клиентом с первой сессии.
            </p>
            <p style={{ fontSize: 13.5, color: "#1C1C1E", lineHeight: 1.6, fontWeight: 500 }}>
              В ТОЛК ассистент знает историю каждого вашего клиента по всем сессиям — можно спросить о динамике или темах за любой период, и он ответит точно, потому что был на всех ваших сессиях. Работает из вашей личной базы знаний: загрузили любимые техники КПТ — он подбирает именно их, а не общие шаблоны. Чем дольше вы работаете, тем точнее он понимает ваш подход.
            </p>
          </motion.div>
        </div>
      </section>

      {/*
        АРХИВ: обычная сетка из 3 платных тарифов (Практика / Профессионал / Эксперт).
        Временно заменена на 2 карточки бета-тестирования (см. BETA_PRICING_PLANS ниже).
        Чтобы вернуть — раскомментировать этот массив и в разделе Pricing заменить
        `.map` на PRICING_PLANS_ARCHIVE вместо BETA_PRICING_PLANS.

        const PRICING_PLANS_ARCHIVE = [
          {
            name: "Практика",
            price: "1 990 ₽",
            period: "в месяц",
            description: "До 5 клиентов",
            features: [
              "60 запросов к ассистенту / мес",
              "Конспект сессии автоматически",
              "Тесты (30+ методик)",
              "Видео + split-screen",
              "Умный календарь, СБП-оплата",
              "Мессенджеры TG + VK",
            ],
            highlighted: false,
          },
          {
            name: "Профессионал",
            price: "3 290 ₽",
            period: "в месяц",
            description: "До 15 клиентов",
            features: [
              "200 запросов к ассистенту / мес",
              "Всё из тарифа Практика",
              "Дневник и база знаний",
              "Vision-разбор фото/бланков",
              "Режим «Супервизор»",
              "Сообщество и мастер-классы",
            ],
            highlighted: true,
          },
          {
            name: "Эксперт",
            price: "5 490 ₽",
            period: "в месяц",
            description: "До 30 клиентов",
            features: [
              "600 запросов к ассистенту / мес",
              "Всё из тарифа Профессионал",
              "Приоритет поддержки",
            ],
            highlighted: false,
          },
        ];
      */}

      {/* Pricing — бета-тестирование: 2 карточки вместо обычной сетки тарифов */}
      <section id="pricing" style={{ padding: "80px 24px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: "0px", top: "0px", zIndex: 0, pointerEvents: "none", opacity: 0.5, transform: "scale(0.75)", transformOrigin: "top right" }}>
          <ScalesArt />
        </div>
        <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative", zIndex: 1 }}>
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#1C1C1E",
              textAlign: "center",
              marginBottom: 12,
            }}
          >
            Присоединяйтесь к бета-тесту
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              textAlign: "center",
              fontSize: 15,
              color: "#6B6058",
              marginBottom: 48,
              maxWidth: 600,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Желающих уже много, а мест на бету всего 25 — условия зафиксируются для вас надолго.
          </motion.p>

          <motion.div
            initial="hidden"
            whileInView="visible"
            variants={containerVariants}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 24,
              maxWidth: 800,
              margin: "0 auto",
            }}
          >
            {[
              {
                name: "Бесплатное место",
                price: "0 ₽",
                period: "",
                badge: "БЕСПЛАТНО",
                description: "2 недели полного доступа бесплатно — попробуйте платформу в деле.",
                oldPrice: undefined as string | undefined,
                features: [
                  "Полный доступ на 2 недели",
                  "Ранний доступ к новым функциям — за 2 недели до остальных",
                ],
                footnote: undefined as string | undefined,
                highlighted: false,
              },
              {
                name: "Платное VIP-место",
                price: "4 900 ₽",
                period: "разово",
                badge: "VIP",
                description: "2 месяца тарифа Эксперт в подарок",
                oldPrice: "2 × 5 490 = 10 980 ₽",
                features: [
                  "Экономия 6 080 ₽ уже на старте",
                  "После беты — тариф Профессионал по фиксированной цене навсегда: 1 990 ₽",
                  "За год только на разнице в цене — от 12 000 ₽ экономии (без учёта роста тарифа)",
                  "Приоритет на бета-тест — желающих много, мест всего 25",
                  "Ваше имя на сайте",
                  "Ранний доступ к новым функциям — за 2 недели до остальных",
                  "Закрытый Telegram-чат с командой",
                  "Ваши запросы в разработку — первыми",
                  "Прямой доступ к основателю",
                ],
                footnote: "4 900 ₽ сейчас — это покупка максимального тарифа на 2 месяца с фиксацией условий на годы вперёд.",
                highlighted: true,
              },
            ].map((plan, i) => (
              <motion.div
                key={i}
                variants={itemVariants}
                whileHover={{
                  y: -10,
                  rotateX: 4,
                  rotateY: plan.highlighted ? 0 : -3,
                  boxShadow: plan.highlighted
                    ? "0 30px 60px rgba(79,126,255,0.35)"
                    : "0 24px 48px rgba(79,126,255,0.18)",
                }}
                style={{
                  padding: 32,
                  background: plan.highlighted
                    ? "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)"
                    : "#FFFFFF",
                  borderRadius: 12,
                  border: plan.highlighted ? "none" : "1px solid #E5DFD5",
                  color: plan.highlighted ? "#fff" : "#1C1C1E",
                  position: "relative",
                  transformStyle: "preserve-3d",
                  perspective: 800,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {plan.badge && (
                  <div
                    style={{
                      position: "absolute",
                      top: -12,
                      right: 24,
                      background: plan.highlighted ? "#fff" : "#2D6A5C",
                      color: plan.highlighted ? "#2D6A5C" : "#fff",
                      padding: "4px 12px",
                      borderRadius: 20,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                    }}
                  >
                    {plan.badge}
                  </div>
                )}

                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, margin: "0 0 4px 0" }}>
                  {plan.name}
                </h3>
                <p
                  style={{
                    fontSize: 12.5,
                    opacity: plan.highlighted ? 0.85 : 0.75,
                    marginBottom: 20,
                    margin: "0 0 20px 0",
                    lineHeight: 1.5,
                  }}
                >
                  {plan.description}
                </p>

                {plan.oldPrice && (
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 13.5, opacity: 0.6, textDecoration: "line-through" }}>{plan.oldPrice}</span>
                  </div>
                )}

                <div style={{ marginBottom: 24, display: "flex", alignItems: "baseline", gap: 6, flexWrap: "nowrap", whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 36, fontWeight: 800 }}>{plan.price}</span>
                  {plan.period && <span style={{ fontSize: 13, opacity: 0.8 }}>{plan.period}</span>}
                </div>

                <ul style={{ listStyle: "none", padding: 0, marginBottom: 24, flex: 1 }}>
                  {plan.features.map((f, j) => (
                    <li key={j} style={{ fontSize: 13, marginBottom: 12, display: "flex", gap: 8, lineHeight: 1.4 }}>
                      <span>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {plan.footnote && (
                  <p
                    style={{
                      fontSize: 11.5,
                      opacity: 0.8,
                      lineHeight: 1.5,
                      marginBottom: 20,
                      margin: "0 0 20px 0",
                      fontStyle: "italic",
                    }}
                  >
                    {plan.footnote}
                  </p>
                )}

                <Link
                  href="/login"
                  style={{
                    display: "block",
                    padding: "12px 16px",
                    background: plan.highlighted ? "#FFFFFF" : "#2D6A5C",
                    color: plan.highlighted ? "#2D6A5C" : "#fff",
                    borderRadius: 8,
                    textDecoration: "none",
                    textAlign: "center",
                    fontSize: 14,
                    fontWeight: 600,
                    transition: "all 0.2s",
                  }}
                >
                  {plan.highlighted ? "Занять VIP-место" : "Занять бесплатное место"}
                </Link>
              </motion.div>
            ))}
          </motion.div>

          {/* Бейджи доверия */}
          <TrustBadges />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" style={{ padding: "80px 24px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "#1C1C1E",
              textAlign: "center",
              marginBottom: 48,
            }}
          >
            Часто спрашивают
          </motion.h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {faqItems.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: i * 0.05 }}
              >
                <button
                  onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                  style={{
                    width: "100%",
                    padding: 20,
                    background: expandedFaq === i ? "#E8F2EF" : "#FFFFFF",
                    border: "1px solid #E5DFD5",
                    borderRadius: 8,
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    transition: "all 0.2s",
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#1C1C1E" }}>{item.q}</span>
                  <ChevronDown
                    size={20}
                    style={{
                      color: "#2D6A5C",
                      transform: expandedFaq === i ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s",
                    }}
                  />
                </button>
                {expandedFaq === i && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    style={{
                      padding: item.a === "chat" ? 20 : 20,
                      background: item.a === "chat" ? "#FFFFFF" : "#F5F3EF",
                      borderTop: "1px solid #E5DFD5",
                      borderRadius: "0 0 8px 8px",
                      fontSize: 13,
                      color: "#6B6058",
                      lineHeight: 1.6,
                    }}
                  >
                    {item.a === "chat" ? <AssistantChatSection /> : item.a}
                  </motion.div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section
        style={{
          padding: "80px 24px",
          background: "linear-gradient(135deg, #2D6A5C 0%, #1BAF7A 100%)",
          textAlign: "center",
          color: "#fff",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", right: "-30px", top: "-20px", zIndex: 0, pointerEvents: "none", transform: "scale(0.7)", transformOrigin: "top right" }}>
          <CupArt light />
        </div>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} style={{ position: "relative", zIndex: 1 }}>
          <h2 style={{ fontSize: 40, fontWeight: 800, marginBottom: 16 }}>
            Готовы улучшить качество ваших сессий?
          </h2>
          <p style={{ fontSize: 16, marginBottom: 32, opacity: 0.9 }}>
            Присоединитесь к толковым специалистам.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
            <Link
              href="/login?mode=register"
              style={{
                padding: "16px 40px",
                background: "#FFFFFF",
                color: "#2D6A5C",
                borderRadius: 8,
                textDecoration: "none",
                fontSize: 16,
                fontWeight: 600,
                display: "inline-block",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-4px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              Регистрация
            </Link>
            <Link
              href="/login"
              style={{
                padding: "16px 40px",
                background: "rgba(255, 255, 255, 0.15)",
                color: "#FFFFFF",
                border: "2px solid rgba(255, 255, 255, 0.4)",
                borderRadius: 8,
                textDecoration: "none",
                fontSize: 16,
                fontWeight: 600,
                display: "inline-block",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.25)";
                e.currentTarget.style.transform = "translateY(-4px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              Вход
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Features Modal */}
      <AnimatePresence>
        {showFeaturesModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFeaturesModal(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.4)",
                zIndex: 110,
              }}
            />

            {/* Features Table Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              style={{
                position: "fixed",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 115,
                padding: 20,
              }}
            >
              {/* Content Container */}
              {!selectedFeature ? (
                <div
                  style={{
                    position: "relative",
                    background: "#FFFFFF",
                    borderRadius: 16,
                    padding: 36,
                    maxWidth: 1440,
                    width: "100%",
                    maxHeight: "88vh",
                    overflowY: "auto",
                    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.15)",
                  }}
                >
                  {/* Close button */}
                  <button
                    onClick={() => setShowFeaturesModal(false)}
                    style={{
                      position: "absolute",
                      top: 24,
                      right: 24,
                      background: "none",
                      border: "none",
                      outline: "none",
                      fontSize: 28,
                      cursor: "pointer",
                      color: "#8C7355",
                      lineHeight: 1,
                      zIndex: 1,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#2D6A5C")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#8C7355")}
                  >
                    ✕
                  </button>

                  {/* Features Grid */}
                  <h2 style={{ fontSize: 28, fontWeight: 800, color: "#1C1C1E", marginBottom: 8, textAlign: "center" }}>
                    Все возможности ТОЛК
                  </h2>
                  <p style={{ fontSize: 14, color: "#8C7355", textAlign: "center", marginBottom: 40 }}>
                    Выберите функцию, чтобы узнать подробнее
                  </p>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, 1fr)",
                      gap: 32,
                    }}
                  >
                    {Object.entries(FEATURES_DATA).map(([category, { color, items }]) => (
                      <div key={category}>
                        <h3 style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 18, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          {category}
                        </h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                          {items.map((feature) => {
                            const Icon = feature.icon;
                            return (
                            <button
                              key={feature.id}
                              onClick={() => {
                                setSelectedFeature(feature.id);
                                setCardIndex(0);
                              }}
                              style={{
                                background: "#F5F3EF",
                                border: "1px solid #E5DFD5",
                                borderRadius: 12,
                                padding: 16,
                                textAlign: "left",
                                cursor: "pointer",
                                transition: "all 0.2s",
                                display: "flex",
                                gap: 12,
                                alignItems: "flex-start",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "#E8F2EF";
                                e.currentTarget.style.borderColor = color;
                                e.currentTarget.style.transform = "translateY(-2px)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "#F5F3EF";
                                e.currentTarget.style.borderColor = "#E5DFD5";
                                e.currentTarget.style.transform = "translateY(0)";
                              }}
                            >
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 8,
                                  background: `${color}1A`,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                }}
                              >
                                <Icon size={18} color={color} />
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                  <span style={{ fontSize: 14, fontWeight: 700, color: "#1C1C1E" }}>
                                    {feature.name}
                                  </span>
                                  {feature.badge && (
                                    <span
                                      style={{
                                        fontSize: 9,
                                        fontWeight: 700,
                                        color,
                                        background: `${color}1A`,
                                        padding: "2px 6px",
                                        borderRadius: 10,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.03em",
                                      }}
                                    >
                                      {feature.badge}
                                    </span>
                                  )}
                                </div>
                                <p style={{ fontSize: 12, color: "#6B6058", lineHeight: 1.4, margin: 0 }}>
                                  {feature.desc}
                                </p>
                              </div>
                            </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* Card Stack без контейнера */
                <FeaturesCardStack
                  featureId={selectedFeature}
                  cardIndex={cardIndex}
                  onCardChange={setCardIndex}
                  onBack={() => setSelectedFeature(null)}
                />
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Demo Modal */}
      <AnimatePresence>
        {showDemoModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDemoModal(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.5)",
                zIndex: 110,
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              style={{
                position: "fixed",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 115,
                padding: 20,
              }}
              onClick={() => setShowDemoModal(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "relative",
                  background: "#1C1C1E",
                  borderRadius: 20,
                  padding: 0,
                  maxWidth: 860,
                  width: "100%",
                  boxShadow: "0 30px 90px rgba(0,0,0,0.4)",
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() => setShowDemoModal(false)}
                  style={{
                    position: "absolute",
                    top: 16,
                    right: 16,
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.12)",
                    border: "none",
                    color: "#fff",
                    fontSize: 20,
                    cursor: "pointer",
                    zIndex: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ×
                </button>

                {/* Заглушка видео-плеера */}
                <div
                  style={{
                    aspectRatio: "16/9",
                    background: "linear-gradient(135deg, #1B2340 0%, #1C1C1E 100%)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                  }}
                >
                  <motion.button
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.95 }}
                    style={{
                      width: 84,
                      height: 84,
                      borderRadius: "50%",
                      background: "#2D6A5C",
                      border: "none",
                      color: "#fff",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 24,
                      boxShadow: "0 12px 40px rgba(79,126,255,0.5)",
                    }}
                  >
                    <PlayCircle size={40} />
                  </motion.button>
                  <div style={{ color: "#fff", fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
                    Демо-видео скоро будет здесь
                  </div>
                  <div style={{ color: "#8C7355", fontSize: 13, maxWidth: 420, textAlign: "center", padding: "0 24px" }}>
                    Пока готовим запись — а прямо сейчас можно попробовать интерактивную демку ассистента ниже на странице.
                  </div>
                </div>

                <div style={{ padding: 24, display: "flex", justifyContent: "center" }}>
                  <button
                    onClick={() => setShowDemoModal(false)}
                    style={{
                      padding: "12px 28px",
                      background: "#2D6A5C",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Понятно
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer
        style={{
          padding: "40px 24px",
          background: "#1C1C1E",
          color: "#8C7355",
          fontSize: 12,
          borderTop: "1px solid #1a1f35",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
          <LogoMark size={26} color="#2D6A5C" />
          <span style={{ fontSize: 15, fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.3px" }}>ТОЛК</span>
        </div>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 32, marginBottom: 32 }}>
          {[
            {
              title: "Продукт",
              links: ["Возможности", "Цены", "Демо", "Статус"],
            },
            {
              title: "Компания",
              links: ["О нас", "Блог", "Вакансии", "Контакты"],
            },
            {
              title: "Ресурсы",
              links: ["Документация", "Гайды", "API", "Вебинары"],
            },
            {
              title: "Легально",
              links: ["Приватность", "Условия использования", "152-ФЗ", "Оферта"],
            },
          ].map((col, i) => (
            <div key={i}>
              <div style={{ fontWeight: 700, color: "#fff", marginBottom: 12 }}>{col.title}</div>
              {col.links.map((link, j) => (
                <div key={j} style={{ marginBottom: 8, cursor: "pointer" }}>
                  {link}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ borderTop: "1px solid #1a1f35", paddingTop: 24, textAlign: "center" }}>
          © 2026 ТОЛК — платформа-ассистент для психологов. Все права защищены.
        </div>
      </footer>
    </div>
  );
}

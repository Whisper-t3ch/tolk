// Реквизиты оператора платформы для юридических страниц (/privacy, /terms).
// ВАЖНО: значения в квадратных скобках — заглушки (address, email): заполнить до публичного запуска.
// Пока заглушки не заменены, они видны на странице намеренно.
export const OPERATOR = {
  brand: "ТОЛК",
  site: "tolkplace.ru",
  name: "индивидуальный предприниматель Алейников Артём Анатольевич",
  nameGenitive: "индивидуального предпринимателя Алейникова Артёма Анатольевича",
  inn: "550117070005",
  ogrnip: "323554300070355",
  address: "[адрес для обращений]",
  email: "[email для обращений]",
  updatedAt: "19 октября 2026 г.",
};

export const OPERATOR_LINE = `${OPERATOR.name}, ИНН ${OPERATOR.inn}, ОГРНИП ${OPERATOR.ogrnip}`;

export const OPERATOR_LINE_GENITIVE = `${OPERATOR.nameGenitive}, ИНН ${OPERATOR.inn}, ОГРНИП ${OPERATOR.ogrnip}`;

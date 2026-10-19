// Реквизиты оператора платформы для юридических страниц (/privacy, /terms).
export const OPERATOR = {
  brand: "ТОЛК",
  site: "tolkplace.ru",
  name: "индивидуальный предприниматель Алейников Артём Анатольевич",
  nameGenitive: "индивидуального предпринимателя Алейникова Артёма Анатольевича",
  inn: "550117070005",
  ogrnip: "323554300070355",
  email: "goldwors@gmail.com",
  updatedAt: "19 октября 2026 г.",
};

export const OPERATOR_LINE = `${OPERATOR.name}, ИНН ${OPERATOR.inn}, ОГРНИП ${OPERATOR.ogrnip}`;

export const OPERATOR_LINE_GENITIVE = `${OPERATOR.nameGenitive}, ИНН ${OPERATOR.inn}, ОГРНИП ${OPERATOR.ogrnip}`;

// Реквизиты оператора платформы для юридических страниц (/terms, /privacy, /consent, /client-consent).
export const OPERATOR = {
  brand: "ТОЛК",
  site: "tolkplace.ru",
  name: "индивидуальный предприниматель Алейников Артём Анатольевич",
  nameGenitive: "индивидуального предпринимателя Алейникова Артёма Анатольевича",
  inn: "550117070005",
  ogrnip: "323554300070355",
  email: "tolkplace@gmail.com",
  // Почтовый адрес оператора (укажите, если хотите публиковать): например "644000, г. Омск, ул. ..."
  address: "",
  updatedAt: "20 октября 2026 г.",
};

export const OPERATOR_LINE = `${OPERATOR.name}, ИНН ${OPERATOR.inn}, ОГРНИП ${OPERATOR.ogrnip}`;

export const OPERATOR_LINE_GENITIVE = `${OPERATOR.nameGenitive}, ИНН ${OPERATOR.inn}, ОГРНИП ${OPERATOR.ogrnip}`;

export const OPERATOR_REQUISITES: string[] = [
  OPERATOR.name[0].toUpperCase() + OPERATOR.name.slice(1),
  `ИНН: ${OPERATOR.inn}`,
  `ОГРНИП: ${OPERATOR.ogrnip}`,
  ...(OPERATOR.address ? [`Почтовый адрес: ${OPERATOR.address}`] : []),
  `Электронная почта для обращений: ${OPERATOR.email}`,
  `Сайт: ${OPERATOR.site}`,
];

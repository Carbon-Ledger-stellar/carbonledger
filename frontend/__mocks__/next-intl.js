const en = require('../public/locales/en/common.json');

let messages = en;

function interpolate(template, values) {
  if (!values || typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    values[key] !== undefined ? String(values[key]) : `{${key}}`
  );
}

function translate(namespace, key, values) {
  const ns = messages[namespace];
  const raw = ns && ns[key] !== undefined ? ns[key] : key;
  if (typeof raw === 'string') {
    return interpolate(raw, values);
  }
  return raw;
}

module.exports = {
  setTestLocaleMessages(nextMessages) {
    messages = nextMessages;
  },
  NextIntlClientProvider({ children }) {
    return children;
  },
  useTranslations(namespace) {
    return (key, values) => translate(namespace, key, values);
  },
  useLocale() {
    return 'en';
  },
};

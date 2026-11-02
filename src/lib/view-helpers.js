const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const pluralRules = new Intl.PluralRules('ru-RU');

export function plural(count, one, few, many) {
  const rule = pluralRules.select(Number(count) || 0);
  if (rule === 'one') return one;
  if (rule === 'few') return few;
  return many;
}

export function hueFor(value) {
  let hash = 0;
  for (const ch of String(value)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % 360;
}

export function registerHelpers(handlebars) {
  handlebars.registerHelper('eq', (a, b) => a === b);
  handlebars.registerHelper('plural', (count, one, few, many) => plural(count, one, few, many));
  handlebars.registerHelper('formatDate', (ms) => dateFormatter.format(new Date(Number(ms))));
  handlebars.registerHelper('isoDate', (ms) => new Date(Number(ms)).toISOString());
  handlebars.registerHelper('initial', (name) => String(name ?? '?').charAt(0).toUpperCase());
  handlebars.registerHelper('hue', (name) => hueFor(name));
  handlebars.registerHelper('author', (username, avatar) => ({ username, avatar }));
  handlebars.registerHelper('urlencode', (value) => encodeURIComponent(String(value ?? '')));
}

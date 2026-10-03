// English is the reference catalog and fallback for missing translations.
// No app imports: the same resolver also works on standalone return pages.
export function resolveTranslation(catalogs, language, key, variables) {
  const selected = catalogs[language] || catalogs.en || {};
  let text = selected[key] ?? catalogs.en?.[key] ?? key;
  if (variables) Object.entries(variables).forEach(([name, value]) => {
    text = text.replaceAll(`{${name}}`, value);
  });
  return text;
}

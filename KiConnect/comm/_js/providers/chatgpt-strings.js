// Message keys and variables cross the Python/JavaScript boundary.
// Human-readable text belongs exclusively to the _lang catalogs.
export function identifyChatgptMessage(message) {
  const value = message?.i18n || message;
  const key = typeof value === 'string' ? value : value?.key;
  if (typeof key !== 'string' || !/^chatgpt\.[A-Za-z]+$/.test(key)) return null;
  return { key, vars: value?.vars && typeof value.vars === 'object' ? value.vars : {} };
}

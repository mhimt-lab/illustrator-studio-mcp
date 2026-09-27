/**
 * Redaction for the Windows probe results. Results are attached to a public issue, so every string that
 * reaches a result file first passes through `redactEvidence`: the user name, computer name, domain and
 * the user's folders are replaced with the variable name (`%USERNAME%`, ...), and account SIDs lose
 * their machine-specific part. Matching ignores case and also covers URL-encoded and forward-slash forms.
 *
 * Pure module: no process, file or Illustrator access.
 */
export const REDACTED_VARIABLES = [
  'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ONEDRIVE', 'TEMP', 'TMP', 'HOMEPATH',
  'USERNAME', 'COMPUTERNAME', 'USERDOMAIN', 'USERDNSDOMAIN', 'LOGONSERVER',
];
/**
 * Shorter values are too likely to match unrelated text, so a short account name is replaced only as a whole
 * path or account segment (`DOMAIN\i`, `DOMAIN\i:`, `\i\`); paths that contain it are still covered by the folder values.
 */
const MINIMUM_LENGTH = 3;
const SEGMENT_VARIABLES = new Set(['USERNAME', 'COMPUTERNAME', 'USERDOMAIN']);
const ACCOUNT_SID = /\bS-1-5-21-\d+-\d+-\d+(?:-\d+)?\b/giu;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** `env` is `process.env` on the probe machine; `hostname` is `os.hostname()` when available. */
export function createRedactor(env, hostname = null) {
  const all = REDACTED_VARIABLES
    .map((name) => ({ name, value: env[name] }))
    .concat(hostname ? [{ name: 'COMPUTERNAME', value: hostname }] : [])
    .map((entry) => ({ name: entry.name, value: typeof entry.value === 'string' ? entry.value.replace(/^\\\\/u, '').replace(/[\\/]+$/u, '') : '' }));
  const entries = all.filter((entry) => entry.value.length >= MINIMUM_LENGTH);
  const shortEntries = all.filter((entry) => entry.value.length > 0 && entry.value.length < MINIMUM_LENGTH && SEGMENT_VARIABLES.has(entry.name));
  const bySegment = new Map(shortEntries.map(({ name, value }) => [value.toLowerCase(), name]));
  const rules = [];
  for (const { name, value } of entries) {
    for (const form of new Set([value, value.replaceAll('\\', '/'), encodeURIComponent(value), encodeURIComponent(value.replaceAll('\\', '/'))])) {
      rules.push({ name, form });
    }
  }
  // Longest first, so `C:\Users\name\AppData\Local` becomes `%LOCALAPPDATA%` rather than `%USERPROFILE%\AppData\Local`.
  // One pass over the text: a replacement is never scanned again, so a user name such as `user` cannot
  // corrupt an already written `%USERPROFILE%`.
  rules.sort((a, b) => b.form.length - a.form.length);
  const byForm = new Map();
  for (const { name, form } of rules) if (!byForm.has(form.toLowerCase())) byForm.set(form.toLowerCase(), name);
  // Short names come last in the same pass, only after `\` or `/` and before `\`, `/`, `:`, whitespace, a quote or the end.
  const alternatives = rules.map(({ form }) => escapeRegExp(form));
  if (shortEntries.length > 0) alternatives.push(`(?<=[\\\\/])(?:${shortEntries.map(({ value }) => escapeRegExp(value)).join('|')})(?=[\\\\/:\\s"']|$)`);
  const combined = alternatives.length === 0 ? null : new RegExp(alternatives.join('|'), 'giu');
  const redactText = (text) => {
    const named = combined === null ? text
      : text.replace(combined, (match) => `%${byForm.get(match.toLowerCase()) ?? bySegment.get(match.toLowerCase())}%`);
    return named.replace(ACCOUNT_SID, 'S-1-5-21-%REDACTED%');
  };
  const redact = (value) => {
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map(redact);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [redactText(key), redact(entry)]));
    }
    return value;
  };
  return redact;
}

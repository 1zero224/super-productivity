// The AI writes in the app's UI language, not in English by default: reports,
// suggestion reasons and memory entries are read later inside the app.

import { LanguageCode } from '../../../core/locale.constants';

const EXPLICIT_NAMES: Record<string, string> = {
  [LanguageCode.zh]: 'Simplified Chinese (简体中文)',
  [LanguageCode.zh_tw]: 'Traditional Chinese (繁體中文)',
  [LanguageCode.pt_br]: 'Brazilian Portuguese (português do Brasil)',
  [LanguageCode.ro_md]: 'Romanian (română)',
};

/** Human-readable language name for a LanguageCode, e.g. "German (Deutsch)". */
export const aiLanguageName = (code: string | null | undefined): string => {
  const lang = (code || 'en').toLowerCase();
  if (EXPLICIT_NAMES[lang]) {
    return EXPLICIT_NAMES[lang];
  }
  try {
    const english = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang);
    const native = new Intl.DisplayNames([lang], { type: 'language' }).of(lang);
    if (english && native && english !== native) {
      return `${english} (${native})`;
    }
    return english || lang;
  } catch {
    return lang;
  }
};

/** Output-language rule appended to every built-in prompt. */
export const buildAiLanguageRule = (
  code: string | null | undefined,
  isChat = false,
): string => {
  const name = aiLanguageName(code);
  const base =
    `Output language: write everything you produce (text, markdown, reasons, memory entries, ` +
    `task / subtask titles you create) in ${name} — the user's app language — ` +
    `even when the input data or these instructions are in another language. ` +
    `Keep existing task titles exactly as they are when quoting them.`;
  return isChat
    ? `${base} Exception: if the user clearly writes their chat message in another language, reply in that language.`
    : base;
};

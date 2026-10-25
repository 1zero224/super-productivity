import { aiLanguageName, buildAiLanguageRule } from './ai-language.util';

describe('aiLanguageName', () => {
  it('names Chinese variants explicitly', () => {
    expect(aiLanguageName('zh')).toContain('简体中文');
    expect(aiLanguageName('zh-tw')).toContain('繁體中文');
  });

  it('uses English plus native names for other languages and defaults to English', () => {
    expect(aiLanguageName('de')).toBe('German (Deutsch)');
    expect(aiLanguageName(undefined)).toBe('English');
  });
});

describe('buildAiLanguageRule', () => {
  it('pins report output to the app language', () => {
    const rule = buildAiLanguageRule('zh');
    expect(rule).toContain('Simplified Chinese');
    expect(rule).toContain('memory entries');
    expect(rule).not.toContain('Exception');
  });

  it('lets chat follow a message written in another language', () => {
    expect(buildAiLanguageRule('zh', true)).toContain('Exception');
  });
});

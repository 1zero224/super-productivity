import { normalizeAiSettings } from './ai-settings.service';
import {
  DEFAULT_AI_AUTOMATION_SETTINGS,
  DEFAULT_AI_PROVIDER,
  isProviderConfigured,
  resolveProvider,
} from './ai-client.model';

describe('normalizeAiSettings', () => {
  it('migrates the single pre-provider endpoint into the first provider', () => {
    const s = normalizeAiSettings({
      baseUrl: ' https://api.deepseek.com/v1 ',
      model: 'deepseek-chat',
      apiKey: 'k',
    } as never);
    expect(s.providers).toEqual([
      {
        id: DEFAULT_AI_PROVIDER.id,
        name: 'deepseek.com',
        apiType: 'chat',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: 'k',
      },
    ]);
    expect(s.defaultProviderId).toBe(DEFAULT_AI_PROVIDER.id);
    expect(s.automation).toEqual(DEFAULT_AI_AUTOMATION_SETTINGS);
  });

  it('starts with the default provider when nothing is stored', () => {
    const s = normalizeAiSettings(undefined);
    expect(s.providers).toEqual([DEFAULT_AI_PROVIDER]);
  });

  it('dedupes ids and drops routing / default that point nowhere', () => {
    const s = normalizeAiSettings({
      providers: [
        {
          id: 'a',
          name: 'A',
          apiType: 'responses',
          baseUrl: 'u',
          model: 'm',
          apiKey: '',
        },
        {
          id: 'a',
          name: 'B',
          apiType: 'bogus' as never,
          baseUrl: 'u',
          model: 'm',
          apiKey: '',
        },
      ],
      defaultProviderId: 'gone',
      featureProviders: { weekly: 'a', classify: 'gone' },
    });
    expect(s.providers.map((p) => [p.id, p.apiType])).toEqual([
      ['a', 'responses'],
      ['a-2', 'chat'],
    ]);
    expect(s.defaultProviderId).toBe('a');
    expect(s.featureProviders).toEqual({ weekly: 'a' });
  });

  it('keeps valid automation values and repairs invalid ones', () => {
    const s = normalizeAiSettings({
      automation: {
        isDailyEnabled: false,
        dailyTime: '07:15',
        isEveningEnabled: false,
        eveningTime: 'late',
        isWeeklyEnabled: true,
        weeklyDay: 9,
        weeklyTime: '25:00',
        isAutoOpen: false,
        isAutoQuadrant: false,
      },
    });
    expect(s.automation).toEqual({
      isDailyEnabled: false,
      dailyTime: '07:15',
      isEveningEnabled: false,
      eveningTime: DEFAULT_AI_AUTOMATION_SETTINGS.eveningTime,
      isWeeklyEnabled: true,
      weeklyDay: DEFAULT_AI_AUTOMATION_SETTINGS.weeklyDay,
      weeklyTime: DEFAULT_AI_AUTOMATION_SETTINGS.weeklyTime,
      isAutoOpen: false,
      isAutoQuadrant: false,
    });
  });
});

describe('resolveProvider', () => {
  const settings = normalizeAiSettings({
    providers: [
      { id: 'main', name: 'Main', apiType: 'chat', baseUrl: 'u', model: 'm', apiKey: '' },
      {
        id: 'cheap',
        name: 'Cheap',
        apiType: 'chat',
        baseUrl: 'u',
        model: 'm',
        apiKey: '',
      },
      {
        id: 'strong',
        name: 'Strong',
        apiType: 'responses',
        baseUrl: 'u',
        model: 'm',
        apiKey: '',
      },
    ],
    defaultProviderId: 'main',
    featureProviders: { classify: 'cheap', weekly: 'strong' },
  });

  it('prefers an explicit provider, then the feature routing, then the default', () => {
    expect(resolveProvider(settings, 'strong', 'classify')!.id).toBe('strong');
    expect(resolveProvider(settings, undefined, 'classify')!.id).toBe('cheap');
    expect(resolveProvider(settings, undefined, 'daily')!.id).toBe('main');
    expect(resolveProvider(settings, 'deleted', 'chat')!.id).toBe('main');
  });
});

describe('isProviderConfigured', () => {
  const p = { ...DEFAULT_AI_PROVIDER };

  it('needs a key unless the endpoint is local', () => {
    expect(isProviderConfigured(p)).toBe(false);
    expect(isProviderConfigured({ ...p, apiKey: 'k' })).toBe(true);
    expect(isProviderConfigured({ ...p, baseUrl: 'http://localhost:11434/v1' })).toBe(
      true,
    );
    expect(isProviderConfigured({ ...p, baseUrl: 'http://127.0.0.1:1234' })).toBe(true);
    expect(isProviderConfigured({ ...p, baseUrl: 'http://localhost.evil.com/v1' })).toBe(
      false,
    );
    expect(isProviderConfigured({ ...p, apiKey: 'k', model: ' ' })).toBe(false);
  });
});

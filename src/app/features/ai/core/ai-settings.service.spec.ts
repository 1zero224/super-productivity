import { normalizeAiSettings } from './ai-settings.service';
import { DEFAULT_AI_AUTOMATION_SETTINGS } from './ai-client.model';

describe('normalizeAiSettings', () => {
  it('fills defaults for settings stored before automation existed', () => {
    const s = normalizeAiSettings({ baseUrl: ' https://x/v1 ', model: 'm', apiKey: 'k' });
    expect(s.baseUrl).toBe('https://x/v1');
    expect(s.automation).toEqual(DEFAULT_AI_AUTOMATION_SETTINGS);
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

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { AiSettingsFormComponent } from './ai-settings-form.component';
import { AiSettingsService } from '../../core/ai-settings.service';
import { AiClientService } from '../../core/ai-client.service';
import { AiSettings, DEFAULT_AI_AUTOMATION_SETTINGS } from '../../core/ai-client.model';

const SETTINGS: AiSettings = {
  providers: [
    {
      id: 'ready',
      name: 'DeepSeek',
      apiType: 'chat',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'k',
    },
    {
      id: 'todo',
      name: '',
      apiType: 'responses',
      baseUrl: '',
      model: '',
      apiKey: '',
    },
  ],
  defaultProviderId: 'ready',
  featureProviders: {},
  automation: DEFAULT_AI_AUTOMATION_SETTINGS,
};

describe('AiSettingsFormComponent', () => {
  let fixture: ComponentFixture<AiSettingsFormComponent>;
  let el: HTMLElement;

  const summaries = (): HTMLButtonElement[] =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('.provider-summary'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AiSettingsFormComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        {
          provide: AiSettingsService,
          useValue: {
            settings: signal(SETTINGS),
            load: () => Promise.resolve(SETTINGS),
            save: jasmine.createSpy('save').and.resolveTo(),
          },
        },
        { provide: AiClientService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AiSettingsFormComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('collapses configured providers and opens incomplete ones', () => {
    expect(summaries().map((b) => b.getAttribute('aria-expanded'))).toEqual([
      'false',
      'true',
    ]);
    expect(el.querySelectorAll('.provider-body').length).toBe(1);
    expect(summaries()[0].textContent).toContain('DeepSeek');
    expect(summaries()[0].textContent).toContain('deepseek-chat');
    // Incomplete providers carry a warning in their summary
    expect(summaries()[1].querySelector('.summary-warn')).toBeTruthy();
  });

  it('toggles a provider open and closed', () => {
    summaries()[0].click();
    fixture.detectChanges();
    expect(summaries()[0].getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelectorAll('.provider-body').length).toBe(2);

    summaries()[0].click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.provider-body').length).toBe(1);
  });

  it('opens a newly added provider', () => {
    fixture.componentInstance.addProvider();
    fixture.detectChanges();
    expect(summaries().length).toBe(3);
    expect(summaries()[2].getAttribute('aria-expanded')).toBe('true');
  });
});

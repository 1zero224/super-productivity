import { buildReflectionInput, nextDay, pruneDrafts } from './evening-review.service';
import {
  createEmptyDraft,
  EveningReviewDraft,
  ReviewFocus,
} from './evening-review.model';

const at = (h: number, m = 0): number => new Date(2026, 10, 1, h, m).getTime();

const focus = (patch: Partial<ReviewFocus> = {}): ReviewFocus => ({
  id: 'f1',
  start: at(13, 30),
  end: at(15, 10),
  observation: {
    start: at(13, 30),
    end: at(15, 10),
    activeMinutes: 80,
    idleMinutes: 10,
    unrecordedMinutes: 10,
    apps: [{ app: 'Code', minutes: 60 }],
    titles: [{ app: 'Code', title: 'secret-project.ts', minutes: 60 }],
  },
  isShareTitles: false,
  views: ['overran'],
  influences: ['lost_track_of_time'],
  note: 'Only meant to fix a style issue',
  taskIds: ['t1', 'gone'],
  ...patch,
});

const draft = (patch: Partial<EveningReviewDraft> = {}): EveningReviewDraft => ({
  ...createEmptyDraft('2026-11-01'),
  disposition: 'reviewed',
  focuses: [focus()],
  offScreenNote: 'Team meeting',
  ...patch,
});

const lookup = (id: string): { title: string; isDone: boolean } | undefined =>
  id === 't1' ? { title: 'Adjust home page style', isDone: true } : undefined;

describe('buildReflectionInput', () => {
  it('sends the chosen range, the user reading and wrapped user text', () => {
    const input = buildReflectionInput(draft(), lookup);
    const f = input.focuses[0];
    expect(f.timeRange).toBe('13:30–15:10');
    expect(f.userView).toEqual(['overran']);
    expect(f.influences).toEqual(['lost_track_of_time']);
    expect(f.note).toContain('<untrusted_user_content>');
    // Unknown task ids are dropped; titles are wrapped
    expect(f.relatedTasks.length).toBe(1);
    expect(f.relatedTasks[0].isDone).toBeTrue();
    expect(f.activityObservation!.apps[0].app).toContain('Code');
    expect(input.offScreenNote).toContain('Team meeting');
  });

  it('never sends window titles unless the user opted in', () => {
    expect(
      JSON.stringify(buildReflectionInput(draft(), lookup)).includes('secret-project'),
    ).toBeFalse();
    const shared = buildReflectionInput(
      draft({ focuses: [focus({ isShareTitles: true })] }),
      lookup,
    );
    expect(shared.focuses[0].activityObservation!.titles!.length).toBe(1);
  });

  it('drops the follow-up answers when the user found the time fine', () => {
    const input = buildReflectionInput(
      draft({ focuses: [focus({ views: ['as_intended'] })] }),
      lookup,
    );
    expect(input.focuses[0].influences).toEqual([]);
  });

  it('sends nothing about the day when the user ended the review', () => {
    const input = buildReflectionInput(draft({ disposition: 'skipped' }), lookup);
    expect(input.disposition).toBe('skipped');
    expect(input.focuses).toEqual([]);
    expect(input.offScreenNote).toBeNull();
  });

  it('has no time range for a stretch described from memory', () => {
    const input = buildReflectionInput(
      draft({ focuses: [focus({ start: 0, end: 0, observation: null })] }),
      lookup,
    );
    expect(input.focuses[0].timeRange).toBeNull();
    expect(input.focuses[0].activityObservation).toBeNull();
  });
});

describe('pruneDrafts / nextDay', () => {
  it('keeps the newest days only', () => {
    const drafts = Object.fromEntries(
      ['2026-10-30', '2026-11-01', '2026-10-31'].map((d) => [d, createEmptyDraft(d)]),
    );
    expect(Object.keys(pruneDrafts(drafts, 2)).sort()).toEqual([
      '2026-10-31',
      '2026-11-01',
    ]);
  });

  it('steps to the next calendar day', () => {
    expect(nextDay('2026-10-31')).toBe('2026-11-01');
  });
});

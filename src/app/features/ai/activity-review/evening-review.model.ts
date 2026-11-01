import { ActivityObservation } from './aw-activity.util';

// How the user sees the chosen time. One neutral set for every app: the
// records never decide which time "needs" explaining.
export const REVIEW_VIEWS = [
  'as_intended',
  'overran',
  'never_started',
  'blocked',
  'reprioritized',
  'record_misleading',
] as const;
export type ReviewView = (typeof REVIEW_VIEWS)[number];

// Views that mean "I would arrange this differently" and unlock the follow-up
export const ADJUST_VIEWS: ReviewView[] = [
  'overran',
  'never_started',
  'blocked',
  'reprioritized',
];

export const REVIEW_INFLUENCES = [
  'next_step_unclear',
  'harder_than_expected',
  'interrupted',
  'tired',
  'lost_track_of_time',
  'other',
] as const;
export type ReviewInfluence = (typeof REVIEW_INFLUENCES)[number];

// pending = not answered yet (never generate), reviewed = at least one focus,
// acceptable = "the day was fine overall", skipped = "end for today"
export type ReviewDisposition = 'pending' | 'reviewed' | 'acceptable' | 'skipped';

/** One time range the user chose to look at, with their own reading of it. */
export interface ReviewFocus {
  id: string;
  start: number;
  end: number;
  // Snapshot taken when the range was chosen; later refetches never touch it.
  // null = chosen from memory without ActivityWatch records.
  observation: ActivityObservation | null;
  // Window titles may be sensitive: only sent to the AI when the user opts in
  isShareTitles: boolean;
  views: ReviewView[];
  influences: ReviewInfluence[];
  note: string;
  // "This reflection is about these tasks" — never a time allocation
  taskIds: string[];
}

/** The device-local review of one logical day. */
export interface EveningReviewDraft {
  day: string;
  disposition: ReviewDisposition;
  focuses: ReviewFocus[];
  // Things the computer did not see (meetings, offline work, rest…)
  offScreenNote: string;
  // Bumped on every answer change; a report remembers the revision it used
  revision: number;
  updated: number;
}

export type AdjustmentFeedback =
  | 'helped'
  | 'not_helpful'
  | 'not_tried'
  | 'not_applicable'
  | 'dismissed';

/** A suggested adjustment the user chose to try on `targetDay`. */
export interface AdoptedAdjustment {
  reportId: string;
  text: string;
  adoptedOn: string;
  targetDay: string;
  feedback?: AdjustmentFeedback;
}

export const createEmptyDraft = (day: string): EveningReviewDraft => ({
  day,
  disposition: 'pending',
  focuses: [],
  offScreenNote: '',
  revision: 0,
  updated: Date.now(),
});

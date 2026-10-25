import { IMPORTANT_TAG, TODAY_TAG, URGENT_TAG } from '../../tag/tag.const';

/**
 * Eisenhower quadrants. Every parent task should carry exactly one explicit
 * quadrant tag (e.g. "重要且紧急"); the built-in important / urgent tags are
 * kept in sync so the Eisenhower board stays correct.
 */
export type AiQuadrant = 'q1' | 'q2' | 'q3' | 'q4';
export const AI_QUADRANTS: AiQuadrant[] = ['q1', 'q2', 'q3', 'q4'];

export type AiQuadrantTagMap = Partial<Record<AiQuadrant, string>>;

export const quadrantFromFlags = (isImportant: boolean, isUrgent: boolean): AiQuadrant =>
  isImportant ? (isUrgent ? 'q1' : 'q2') : isUrgent ? 'q3' : 'q4';

export const flagsFromQuadrant = (
  q: AiQuadrant,
): { important: boolean; urgent: boolean } => ({
  important: q === 'q1' || q === 'q2',
  urgent: q === 'q1' || q === 'q3',
});

// Compared after normalizeTagTitle(); order matters only for readability
const QUADRANT_ALIASES: Record<AiQuadrant, string[]> = {
  q1: [
    '重要且紧急',
    '重要紧急',
    '重要并且紧急',
    '紧急且重要',
    '紧急重要',
    '重要又紧急',
    'importanturgent',
    'urgentimportant',
  ],
  q2: [
    '重要不紧急',
    '重要但不紧急',
    '重要且不紧急',
    '不紧急但重要',
    '不紧急重要',
    'importantnoturgent',
    'noturgentimportant',
  ],
  q3: [
    '不重要但紧急',
    '不重要紧急',
    '不重要且紧急',
    '紧急不重要',
    '紧急但不重要',
    'notimportanturgent',
    'urgentnotimportant',
  ],
  q4: [
    '不重要不紧急',
    '不重要且不紧急',
    '不紧急不重要',
    '既不重要也不紧急',
    'notimportantnoturgent',
    'noturgentnotimportant',
  ],
};

export const QUADRANT_TAG_TITLES: Record<'zh' | 'en', Record<AiQuadrant, string>> = {
  zh: { q1: '重要且紧急', q2: '重要不紧急', q3: '不重要但紧急', q4: '不重要不紧急' },
  en: {
    q1: 'Important & urgent',
    q2: 'Important, not urgent',
    q3: 'Urgent, not important',
    q4: 'Not important, not urgent',
  },
};

export const normalizeTagTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/\band\b/g, '')
    .replace(/[\s#&+,，、_\-/|·.]+/g, '');

export const quadrantForTagTitle = (title: string): AiQuadrant | null => {
  const norm = normalizeTagTitle(title);
  for (const q of AI_QUADRANTS) {
    if (QUADRANT_ALIASES[q].includes(norm)) {
      return q;
    }
  }
  return null;
};

/** Finds the tag used for each quadrant; the first match per quadrant wins. */
export const resolveQuadrantTagIds = (
  tags: { id: string; title: string }[],
): AiQuadrantTagMap => {
  const map: AiQuadrantTagMap = {};
  for (const tag of tags) {
    if (
      tag.id === IMPORTANT_TAG.id ||
      tag.id === URGENT_TAG.id ||
      tag.id === TODAY_TAG.id
    ) {
      continue;
    }
    const q = quadrantForTagTitle(tag.title || '');
    if (q && !map[q]) {
      map[q] = tag.id;
    }
  }
  return map;
};

/** The task's explicit quadrant, or null when it has no quadrant tag. */
export const getTaskQuadrant = (
  tagIds: string[],
  map: AiQuadrantTagMap,
): AiQuadrant | null =>
  AI_QUADRANTS.find((q) => !!map[q] && tagIds.includes(map[q]!)) ?? null;

/**
 * New tag list for a quadrant: drops every quadrant tag, the built-in
 * important / urgent tags and the virtual TODAY tag, then adds the built-in
 * flags plus the explicit quadrant tag (when one is known).
 */
export const computeQuadrantTagIds = (
  currentTagIds: string[],
  isImportant: boolean,
  isUrgent: boolean,
  map: AiQuadrantTagMap = {},
): string[] => {
  const quadrantTagIds = new Set(Object.values(map));
  const base = currentTagIds.filter(
    (id) =>
      id !== IMPORTANT_TAG.id &&
      id !== URGENT_TAG.id &&
      id !== TODAY_TAG.id &&
      !quadrantTagIds.has(id),
  );
  const explicit = map[quadrantFromFlags(isImportant, isUrgent)];
  return [
    ...base,
    ...(isImportant ? [IMPORTANT_TAG.id] : []),
    ...(isUrgent ? [URGENT_TAG.id] : []),
    ...(explicit ? [explicit] : []),
  ];
};

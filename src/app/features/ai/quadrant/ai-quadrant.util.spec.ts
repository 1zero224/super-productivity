import {
  computeQuadrantTagIds,
  getTaskQuadrant,
  quadrantForTagTitle,
  quadrantFromFlags,
  resolveQuadrantTagIds,
} from './ai-quadrant.util';
import { IMPORTANT_TAG, TODAY_TAG, URGENT_TAG } from '../../tag/tag.const';

// The quadrant tags as they appear in the user's TickTick import
const TAGS = [
  { id: IMPORTANT_TAG.id, title: 'important' },
  { id: URGENT_TAG.id, title: 'urgent' },
  { id: 'dida-tag-job', title: 'job' },
  { id: 'dida-tag-不重要不紧急', title: '不重要不紧急' },
  { id: 'dida-tag-不重要但紧急', title: '不重要但紧急' },
  { id: 'dida-tag-重要不紧急', title: '重要不紧急' },
  { id: 'dida-tag-重要且紧急', title: '重要且紧急' },
];
const MAP = resolveQuadrantTagIds(TAGS);

describe('quadrant tag resolution', () => {
  it('finds the four quadrant tags by name and ignores the built-in flags', () => {
    expect(MAP).toEqual({
      q1: 'dida-tag-重要且紧急',
      q2: 'dida-tag-重要不紧急',
      q3: 'dida-tag-不重要但紧急',
      q4: 'dida-tag-不重要不紧急',
    });
  });

  it('accepts common spellings in Chinese and English', () => {
    expect(quadrantForTagTitle('#紧急 不重要')).toBe('q3');
    expect(quadrantForTagTitle('Important & Urgent')).toBe('q1');
    expect(quadrantForTagTitle('Not important, not urgent')).toBe('q4');
    expect(quadrantForTagTitle('important')).toBeNull();
    expect(quadrantForTagTitle('job')).toBeNull();
  });
});

describe('getTaskQuadrant', () => {
  it('reads the explicit tag; built-in flags alone count as unclassified', () => {
    expect(getTaskQuadrant(['dida-tag-重要不紧急', IMPORTANT_TAG.id], MAP)).toBe('q2');
    expect(getTaskQuadrant([IMPORTANT_TAG.id, URGENT_TAG.id], MAP)).toBeNull();
    expect(getTaskQuadrant(['dida-tag-job'], MAP)).toBeNull();
  });
});

describe('computeQuadrantTagIds', () => {
  it('keeps exactly one quadrant tag in sync with the built-in flags', () => {
    expect(
      computeQuadrantTagIds(
        ['dida-tag-job', 'dida-tag-不重要不紧急', TODAY_TAG.id],
        true,
        true,
        MAP,
      ),
    ).toEqual(['dida-tag-job', IMPORTANT_TAG.id, URGENT_TAG.id, 'dida-tag-重要且紧急']);
    expect(
      computeQuadrantTagIds([IMPORTANT_TAG.id, 'dida-tag-重要不紧急'], false, false, MAP),
    ).toEqual(['dida-tag-不重要不紧急']);
  });

  it('falls back to the built-in flags when no quadrant tags are known', () => {
    expect(computeQuadrantTagIds(['a', URGENT_TAG.id], true, false)).toEqual([
      'a',
      IMPORTANT_TAG.id,
    ]);
  });

  it('maps flags to quadrants', () => {
    expect(quadrantFromFlags(true, true)).toBe('q1');
    expect(quadrantFromFlags(true, false)).toBe('q2');
    expect(quadrantFromFlags(false, true)).toBe('q3');
    expect(quadrantFromFlags(false, false)).toBe('q4');
  });
});

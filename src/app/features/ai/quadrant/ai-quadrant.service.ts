import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { selectAllTags } from '../../tag/store/tag.reducer';
import { TagService } from '../../tag/tag.service';
import { selectAllTasks } from '../../tasks/store/task.selectors';
import { Task } from '../../tasks/task.model';
import {
  AI_QUADRANTS,
  AiQuadrant,
  AiQuadrantTagMap,
  getTaskQuadrant,
  QUADRANT_TAG_TITLES,
  resolveQuadrantTagIds,
} from './ai-quadrant.util';

/** Resolves (and creates when missing) the four explicit quadrant tags. */
@Injectable({ providedIn: 'root' })
export class AiQuadrantService {
  private readonly _store = inject(Store);
  private readonly _tagService = inject(TagService);
  private readonly _translateService = inject(TranslateService);

  private readonly _tags = toSignal(this._store.select(selectAllTags), {
    initialValue: [],
  });
  // Tags created here before the store emitted them
  private readonly _created: AiQuadrantTagMap = {};

  readonly map = computed<AiQuadrantTagMap>(() => ({
    ...this._created,
    ...resolveQuadrantTagIds(this._tags()),
  }));

  private readonly _tasks = toSignal(this._store.select(selectAllTasks), {
    initialValue: [],
  });

  /** Undone parent tasks without an explicit quadrant tag. */
  readonly unclassifiedTasks = computed<Task[]>(() => {
    const map = this.map();
    return this._tasks().filter(
      (t) => !t.parentId && !t.isDone && !getTaskQuadrant(t.tagIds, map),
    );
  });

  quadrantOf(tagIds: string[]): AiQuadrant | null {
    return getTaskQuadrant(tagIds, this.map());
  }

  /** The tag map with every quadrant present; missing tags are created. */
  ensureTags(): AiQuadrantTagMap {
    const map = { ...this.map() };
    const lang = (this._translateService.getCurrentLang() || '').startsWith('zh')
      ? 'zh'
      : 'en';
    for (const q of AI_QUADRANTS) {
      if (!map[q]) {
        const id = this._tagService.addTag({ title: QUADRANT_TAG_TITLES[lang][q] });
        this._created[q] = id;
        map[q] = id;
      }
    }
    return map;
  }
}

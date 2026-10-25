import {
  EnvironmentProviders,
  inject,
  Injector,
  provideAppInitializer,
} from '@angular/core';
import { take } from 'rxjs/operators';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { Log } from '../../core/log';

// Same spirit as the deferred block in StartupService: let the UI settle first
const AI_SCHEDULER_START_DELAY_MS = 5000;

/**
 * Starts the scheduled AI reports once all data is loaded. Eager on purpose
 * but tiny: the AI code itself is only pulled in via dynamic import, keeping
 * it out of the initial bundle.
 */
export const provideAiStartup = (): EnvironmentProviders =>
  provideAppInitializer(() => {
    const injector = inject(Injector);
    inject(DataInitStateService)
      .isAllDataLoadedInitially$.pipe(take(1))
      .subscribe(() =>
        window.setTimeout(() => {
          Promise.all([
            import('./automation/ai-scheduler.service'),
            import('./quadrant/ai-auto-quadrant.service'),
          ])
            .then(([{ AiSchedulerService }, { AiAutoQuadrantService }]) => {
              injector.get(AiSchedulerService).init();
              injector.get(AiAutoQuadrantService).init();
            })
            .catch((err) =>
              Log.err({ stage: 'init-ai-scheduler', error: (err as Error).message }),
            );
        }, AI_SCHEDULER_START_DELAY_MS),
      );
  });

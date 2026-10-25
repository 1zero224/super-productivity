import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { selectAllTasks } from '../../tasks/store/task.selectors';
import { selectAllProjects } from '../../project/store/project.selectors';
import { Task } from '../../tasks/task.model';
import { TaskArchiveService } from '../../archive/task-archive.service';
import {
  AiTaskSummary,
  AiTaskToolsService,
  parseLocalDay,
} from '../tools/ai-task-tools.service';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { Log } from '../../../core/log';

const AiLog = Log.withContext('ai');
const MS_PER_MIN = 60_000;
const MAX_TODAY = 40;
const MAX_OVERDUE = 20;
const MAX_BACKLOG = 40;
const MAX_WEEK_TASKS = 30;
const MAX_DONE = 40;

export interface AiDailyReportData {
  today: string;
  now: string;
  todayTasks: AiTaskSummary[];
  overdueTasks: AiTaskSummary[];
  // Undone parent tasks that are neither planned for today nor overdue
  backlogTasks: AiTaskSummary[];
}

export interface AiWeekTaskTime {
  id: string;
  title: string;
  project?: string;
  minutes: number;
  isDone: boolean;
}

export interface AiWeeklyReportData {
  fromDay: string;
  toDay: string;
  minutesPerDay: Record<string, number>;
  totalMinutes: number;
  topTasks: AiWeekTaskTime[];
  doneTasks: { id: string; title: string; project?: string; doneOn: string }[];
}

/** The 7 logical days ending on `toDay` (inclusive), oldest first. */
export const getWeekDays = (toDay: string): string[] => {
  const end = parseLocalDay(toDay);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(end);
    d.setDate(end.getDate() - (6 - i));
    return getDbDateStr(d);
  });
};

/** Aggregates time tracking and completions of `tasks` within `days`. */
export const aggregateWeek = (
  tasks: Task[],
  days: string[],
  projectTitles: Record<string, string>,
): AiWeeklyReportData => {
  const daySet = new Set(days);
  const minutesPerDay: Record<string, number> = Object.fromEntries(
    days.map((d) => [d, 0]),
  );
  const perTask: AiWeekTaskTime[] = [];
  const doneTasks: AiWeeklyReportData['doneTasks'] = [];
  const seen = new Set<string>();

  for (const t of tasks) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    let ms = 0;
    // Subtask time is already contained in the parent's time
    if (!t.parentId) {
      for (const [day, spent] of Object.entries(t.timeSpentOnDay || {})) {
        if (daySet.has(day) && spent > 0) {
          ms += spent;
          minutesPerDay[day] += spent / MS_PER_MIN;
        }
      }
    }
    const project = t.projectId ? projectTitles[t.projectId] : undefined;
    if (ms > 0) {
      perTask.push({
        id: t.id,
        title: t.title,
        ...(project ? { project } : {}),
        minutes: Math.round(ms / MS_PER_MIN),
        isDone: t.isDone,
      });
    }
    if (t.isDone && t.doneOn) {
      const doneDay = getDbDateStr(new Date(t.doneOn));
      if (daySet.has(doneDay)) {
        doneTasks.push({
          id: t.id,
          title: t.title,
          ...(project ? { project } : {}),
          doneOn: doneDay,
        });
      }
    }
  }

  for (const d of days) {
    minutesPerDay[d] = Math.round(minutesPerDay[d]);
  }
  return {
    fromDay: days[0],
    toDay: days[days.length - 1],
    minutesPerDay,
    totalMinutes: Object.values(minutesPerDay).reduce((a, b) => a + b, 0),
    topTasks: perTask.sort((a, b) => b.minutes - a.minutes).slice(0, MAX_WEEK_TASKS),
    doneTasks: doneTasks.slice(0, MAX_DONE),
  };
};

/**
 * Collects the task data a report prompt needs, deterministically (no model
 * tool calls), so reports are cheap and reproducible.
 */
@Injectable({ providedIn: 'root' })
export class AiReportDataService {
  private readonly _store = inject(Store);
  private readonly _tools = inject(AiTaskToolsService);
  private readonly _taskArchiveService = inject(TaskArchiveService);

  async collectDaily(today: string): Promise<AiDailyReportData> {
    const [todayTasks, overdueTasks, allUndone] = await Promise.all([
      this._tools.listTasks('today', MAX_TODAY),
      this._tools.listTasks('overdue', MAX_OVERDUE),
      this._tools.listTasks('all_undone', 100),
    ]);
    const plannedIds = new Set([...todayTasks, ...overdueTasks].map((t) => t.id));
    return {
      today,
      now: new Date().toLocaleString(),
      todayTasks: todayTasks.filter((t) => !t.isDone),
      overdueTasks,
      backlogTasks: allUndone.filter((t) => !plannedIds.has(t.id)).slice(0, MAX_BACKLOG),
    };
  }

  async collectWeekly(toDay: string): Promise<AiWeeklyReportData> {
    const [tasks, projects] = await Promise.all([
      firstValueFrom(this._store.select(selectAllTasks)),
      firstValueFrom(this._store.select(selectAllProjects)),
    ]);
    let archived: Task[] = [];
    try {
      const archive = await this._taskArchiveService.loadYoung();
      archived = archive.ids
        .map((id) => archive.entities[id])
        .filter((t): t is Task => !!t);
    } catch (e) {
      AiLog.err('AiReportDataService: failed to load archive', e);
    }
    const projectTitles = Object.fromEntries(projects.map((p) => [p.id, p.title]));
    return aggregateWeek([...tasks, ...archived], getWeekDays(toDay), projectTitles);
  }
}

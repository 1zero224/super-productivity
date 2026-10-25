import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import {
  AiTaskToolsService,
  buildRepeatCfg,
  computeQuadrantTagIds,
  parseLocalDay,
  wrapUntrusted,
} from './ai-task-tools.service';
import { TaskRepeatCfgService } from '../../task-repeat-cfg/task-repeat-cfg.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskReminderOptionId } from '../../tasks/task.model';
import { PlannerActions } from '../../planner/store/planner.actions';
import { TaskService } from '../../tasks/task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { DateService } from '../../../core/date/date.service';
import { selectTaskEntities } from '../../tasks/store/task.selectors';
import { selectAllProjects } from '../../project/store/project.selectors';
import { IMPORTANT_TAG, TODAY_TAG, URGENT_TAG } from '../../tag/tag.const';
import { DEFAULT_TASK, Task } from '../../tasks/task.model';
import { addSubTask } from '../../tasks/store/task.actions';
import { WorkContextType } from '../../work-context/work-context.model';

const task = (over: Partial<Task>): Task =>
  ({ ...DEFAULT_TASK, id: 'x', title: 'X', projectId: 'p1', ...over }) as Task;

describe('computeQuadrantTagIds', () => {
  it('adds and removes the quadrant tags while keeping other tags', () => {
    expect(computeQuadrantTagIds(['a', URGENT_TAG.id], true, false)).toEqual([
      'a',
      IMPORTANT_TAG.id,
    ]);
    expect(computeQuadrantTagIds(['a'], true, true)).toEqual([
      'a',
      IMPORTANT_TAG.id,
      URGENT_TAG.id,
    ]);
  });

  it('never writes the virtual TODAY tag', () => {
    expect(computeQuadrantTagIds([TODAY_TAG.id, 'b'], false, false)).toEqual(['b']);
  });
});

describe('AiTaskToolsService', () => {
  let service: AiTaskToolsService;
  let store: MockStore;
  let taskService: jasmine.SpyObj<TaskService>;
  let taskRepeatCfgService: jasmine.SpyObj<TaskRepeatCfgService>;
  let workContext: {
    activeWorkContextType?: WorkContextType;
    activeWorkContextId?: string;
  };

  const parent = task({ id: 'p', title: 'Parent', tagIds: ['tagA'] });
  const sub = task({ id: 's', parentId: 'p', title: 'Sub' });

  beforeEach(() => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'add',
      'update',
      'updateTags',
      'setDone',
      'createNewTaskWithDefaults',
      'getByIdWithSubTaskData$',
      'addToToday',
      'scheduleTask',
    ]);
    taskService.add.and.returnValue('new-id');
    taskRepeatCfgService = jasmine.createSpyObj<TaskRepeatCfgService>(
      'TaskRepeatCfgService',
      ['addTaskRepeatCfgToTask'],
    );
    taskRepeatCfgService.addTaskRepeatCfgToTask.and.returnValue('cfg-id');
    let n = 0;
    taskService.createNewTaskWithDefaults.and.callFake(({ title, additional }) =>
      task({ id: `n${++n}`, title: title as string, ...additional }),
    );
    workContext = {
      activeWorkContextType: WorkContextType.PROJECT,
      activeWorkContextId: 'p1',
    };

    TestBed.configureTestingModule({
      providers: [
        AiTaskToolsService,
        provideMockStore({
          selectors: [
            {
              selector: selectTaskEntities,
              value: { p: { ...parent, subTaskIds: ['s'] }, s: sub },
            },
            { selector: selectAllProjects, value: [{ id: 'p1', title: 'Proj' }] },
          ],
        }),
        { provide: TaskService, useValue: taskService },
        { provide: WorkContextService, useValue: workContext },
        { provide: DateService, useValue: { todayStr: () => '2026-10-24' } },
        { provide: TaskRepeatCfgService, useValue: taskRepeatCfgService },
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: () => ({
              reminder: { defaultTaskRemindOption: TaskReminderOptionId.AtStart },
            }),
          },
        },
      ],
    });
    service = TestBed.inject(AiTaskToolsService);
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
  });

  it('creates subtasks as one addSubTask action each, ignoring short syntax', async () => {
    const ids = await service.createSubtasks('p', [
      { title: 'Open doc', estimateMinutes: 2 },
      { title: '  ' },
      { title: 'Write intro' },
    ]);
    expect(ids).toEqual(['n1', 'n2']);
    expect(store.dispatch).toHaveBeenCalledTimes(2);
    const first = (store.dispatch as jasmine.Spy).calls.argsFor(0)[0];
    expect(first.type).toBe(addSubTask.type);
    expect(first.parentId).toBe('p');
    expect(first.isIgnoreShortSyntax).toBe(true);
    expect(first.task.timeEstimate).toBe(2 * 60_000);
  });

  it('rejects subtasks for a missing parent or for a subtask parent', async () => {
    await expectAsync(service.createSubtasks('missing', [{ title: 'a' }])).toBeRejected();
    await expectAsync(service.createSubtasks('s', [{ title: 'a' }])).toBeRejected();
  });

  it('creates tasks with quadrant tags and ignores short syntax', () => {
    service.createTask({ title: 'Call bank', isImportant: true, isToday: true });
    const [title, isBacklog, additional, isBottom, isIgnoreShortSyntax] =
      taskService.add.calls.mostRecent().args;
    expect(title).toBe('Call bank');
    expect(isBacklog).toBe(false);
    expect(additional?.tagIds).toEqual([IMPORTANT_TAG.id]);
    expect(additional?.dueDay).toBe('2026-10-24');
    expect(isBottom).toBe(false);
    expect(isIgnoreShortSyntax).toBe(true);
  });

  it('keeps the active tag context when creating in a tag list', () => {
    workContext.activeWorkContextType = WorkContextType.TAG;
    workContext.activeWorkContextId = 'tagCtx';
    service.createTask({ title: 'x', isUrgent: true });
    expect(taskService.add.calls.mostRecent().args[2]?.tagIds).toEqual([
      'tagCtx',
      URGENT_TAG.id,
    ]);
  });

  it('sets quadrant tags on parent tasks only', async () => {
    await service.setQuadrant('p', false, true);
    expect(taskService.updateTags).toHaveBeenCalledWith(
      jasmine.objectContaining({ id: 'p' }),
      ['tagA', URGENT_TAG.id],
    );
    await expectAsync(service.setQuadrant('s', true, true)).toBeRejected();
  });

  it('summarizes a task with wrapped notes and its subtasks', async () => {
    const res = await service.getTaskWithSubtasks('p');
    expect(res?.project).toBe('Proj');
    expect(res?.subTasks.map((s) => s.id)).toEqual(['s']);
    expect(wrapUntrusted('a')).toContain('<untrusted_user_content>');
  });

  it('exposes write tools as kind "write"', () => {
    const tools = service.buildAgentTools();
    const writeNames = tools.filter((t) => t.kind === 'write').map((t) => t.name);
    expect(writeNames).toEqual(
      jasmine.arrayContaining([
        'create_task',
        'create_subtasks',
        'set_quadrant',
        'mark_done',
      ]),
    );
    expect(tools.find((t) => t.name === 'list_tasks')?.kind).toBe('read');
    expect(tools.find((t) => t.name === 'schedule_task')?.kind).toBe('write');
    expect(tools.find((t) => t.name === 'create_repeat_task')?.kind).toBe('write');
  });

  it('plans a task for a day without time via planTaskForDay', async () => {
    await service.scheduleTask('p', '2026-10-30');
    const action = (store.dispatch as jasmine.Spy).calls.mostRecent().args[0];
    expect(action.type).toBe(PlannerActions.planTaskForDay.type);
    expect(action.day).toBe('2026-10-30');
    expect(taskService.scheduleTask).not.toHaveBeenCalled();
  });

  it('schedules a task at an exact time with the default reminder', async () => {
    await service.scheduleTask('p', '2026-10-30', '14:30');
    const [t, due, remind] = taskService.scheduleTask.calls.mostRecent().args;
    expect(t.id).toBe('p');
    expect(due).toBe(new Date(2026, 9, 30, 14, 30).getTime());
    expect(remind).toBe(TaskReminderOptionId.AtStart);
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('rejects invalid schedule input', async () => {
    await expectAsync(service.scheduleTask('missing', '2026-10-30')).toBeRejected();
    await expectAsync(service.scheduleTask('p', '30.10.2026')).toBeRejected();
    await expectAsync(service.scheduleTask('p', '2026-10-30', '25:00')).toBeRejected();
  });

  it('creates a repeating task in the active project', () => {
    const res = service.createRepeatTask({
      title: 'Workout',
      repeatCycle: 'WEEKLY',
      weekdays: [1, 3],
      startTime: '07:00',
    });
    expect(res).toEqual({ taskId: 'new-id', repeatCfgId: 'cfg-id' });
    const [taskId, projectId, cfg] =
      taskRepeatCfgService.addTaskRepeatCfgToTask.calls.mostRecent().args;
    expect(taskId).toBe('new-id');
    expect(projectId).toBe('p1');
    expect(cfg.projectId).toBe('p1');
    expect(cfg.monday).toBe(true);
    expect(cfg.wednesday).toBe(true);
    expect(cfg.friday).toBe(false);
    expect(cfg.startTime).toBe('07:00');
  });
});

describe('parseLocalDay', () => {
  it('parses a local calendar day and rejects invalid ones', () => {
    expect(parseLocalDay('2026-02-28').getDate()).toBe(28);
    expect(() => parseLocalDay('2026-02-30')).toThrow();
    expect(() => parseLocalDay('2026-2-3')).toThrow();
  });
});

describe('buildRepeatCfg', () => {
  it('builds a daily cfg with defaults and an estimate', () => {
    const cfg = buildRepeatCfg(
      { title: 'Read', repeatCycle: 'DAILY', estimateMinutes: 20 },
      '2026-10-24',
    );
    expect(cfg.repeatCycle).toBe('DAILY');
    expect(cfg.repeatEvery).toBe(1);
    expect(cfg.startDate).toBe('2026-10-24');
    expect(cfg.defaultEstimate).toBe(20 * 60_000);
    expect(cfg.title).toBe('Read');
  });

  it('validates the cycle, interval, time and weekdays', () => {
    const base = { title: 'x', repeatCycle: 'WEEKLY' as const };
    expect(() =>
      buildRepeatCfg({ ...base, repeatCycle: 'HOURLY' as never }, '2026-10-24'),
    ).toThrow();
    expect(() => buildRepeatCfg({ ...base, repeatEvery: 0 }, '2026-10-24')).toThrow();
    expect(() => buildRepeatCfg({ ...base, startTime: '7am' }, '2026-10-24')).toThrow();
    expect(() => buildRepeatCfg({ ...base, weekdays: [9] }, '2026-10-24')).toThrow();
  });
});

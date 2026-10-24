import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import {
  AiTaskToolsService,
  computeQuadrantTagIds,
  wrapUntrusted,
} from './ai-task-tools.service';
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
    ]);
    taskService.add.and.returnValue('new-id');
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
  });
});

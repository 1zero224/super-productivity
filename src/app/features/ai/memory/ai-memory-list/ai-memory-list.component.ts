import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';
import { AI_MEMORY_KINDS, AiMemoryKind, AiMemoryService } from '../ai-memory.service';

/** Lists the long-term memory and lets the user add or delete entries. */
@Component({
  selector: 'ai-memory-list',
  imports: [
    DatePipe,
    FormsModule,
    MatButton,
    MatIconButton,
    MatIcon,
    MatFormField,
    MatLabel,
    MatInput,
    MatSelect,
    MatOption,
    MatTooltip,
    TranslatePipe,
  ],
  templateUrl: './ai-memory-list.component.html',
  styleUrl: './ai-memory-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiMemoryListComponent implements OnInit {
  readonly memoryService = inject(AiMemoryService);

  protected readonly T = T;
  readonly KINDS = AI_MEMORY_KINDS;
  readonly KIND_LABELS: Record<AiMemoryKind, string> = {
    preference: T.F.AI.MEMORY.KIND_PREFERENCE,
    habit: T.F.AI.MEMORY.KIND_HABIT,
    review: T.F.AI.MEMORY.KIND_REVIEW,
    fact: T.F.AI.MEMORY.KIND_FACT,
  };
  readonly SOURCE_LABELS = {
    chat: T.F.AI.MEMORY.SOURCE_CHAT,
    weekly: T.F.AI.MEMORY.SOURCE_WEEKLY,
    user: T.F.AI.MEMORY.SOURCE_USER,
  };

  readonly newText = signal('');
  readonly newKind = signal<AiMemoryKind>('preference');

  ngOnInit(): void {
    this.memoryService.load();
  }

  async add(): Promise<void> {
    const text = this.newText().trim();
    if (!text) {
      return;
    }
    await this.memoryService.remember(text, this.newKind(), 'user');
    this.newText.set('');
  }

  remove(id: string): void {
    this.memoryService.remove(id);
  }
}

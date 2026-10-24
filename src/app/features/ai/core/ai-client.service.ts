import { inject, Injectable } from '@angular/core';
import { AiChatRequest, AiChatResult, AiSettings } from './ai-client.model';
import { AiSettingsService } from './ai-settings.service';
import { AiStreamAccumulator, readSseData } from './ai-stream.util';

const REQUEST_TIMEOUT_MS = 120_000;

export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiRequestError';
  }
}

export const buildChatCompletionsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
};

/**
 * Minimal OpenAI-compatible chat client (DeepSeek, Qwen, Kimi, OpenRouter,
 * Ollama, OpenAI…). Desktop-only: Electron strips CORS for renderer fetches.
 */
@Injectable({ providedIn: 'root' })
export class AiClientService {
  private readonly _settingsService = inject(AiSettingsService);

  async chat(req: AiChatRequest): Promise<AiChatResult> {
    const settings = await this._settingsService.load();
    return this.chatWithSettings(settings, req);
  }

  async chatWithSettings(
    settings: AiSettings,
    req: AiChatRequest,
  ): Promise<AiChatResult> {
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      throw new AiRequestError('AI is not configured');
    }
    const isStream = !!req.onTextDelta;
    const body: Record<string, unknown> = {
      model: settings.model,
      messages: req.messages,
      stream: isStream,
    };
    if (req.tools?.length) {
      body.tools = req.tools;
    }
    if (req.isJsonResponse) {
      body.response_format = { type: 'json_object' };
    }
    if (typeof req.temperature === 'number') {
      body.temperature = req.temperature;
    }

    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = req.signal
      ? AbortSignal.any([req.signal, timeoutSignal])
      : timeoutSignal;

    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${settings.apiKey}`);

    let res: Response;
    try {
      res = await fetch(buildChatCompletionsUrl(settings.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (req.signal?.aborted) {
        throw e;
      }
      if (timeoutSignal.aborted) {
        throw new AiRequestError('AI request timed out');
      }
      throw new AiRequestError(`AI request failed: ${(e as Error).message}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AiRequestError(
        `AI request failed (${res.status}): ${text.slice(0, 300)}`,
        res.status,
      );
    }

    if (!isStream || !res.body) {
      const json = (await res.json()) as {
        choices?: {
          message?: { content?: string | null; tool_calls?: AiChatResult['toolCalls'] };
          finish_reason?: string | null;
        }[];
      };
      const choice = json.choices?.[0];
      return {
        content: choice?.message?.content || '',
        toolCalls: choice?.message?.tool_calls || [],
        finishReason: choice?.finish_reason ?? null,
      };
    }

    const acc = new AiStreamAccumulator();
    for await (const data of readSseData(res.body)) {
      let chunk: Parameters<AiStreamAccumulator['push']>[0];
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = acc.push(chunk);
      if (delta) {
        req.onTextDelta?.(delta);
      }
    }
    return acc.result();
  }
}

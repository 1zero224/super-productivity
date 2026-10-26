import { inject, Injectable } from '@angular/core';
import {
  AiChatRequest,
  AiChatResult,
  AiProvider,
  isProviderConfigured,
  resolveProvider,
} from './ai-client.model';
import { AiSettingsService } from './ai-settings.service';
import { AiStreamAccumulator, readSseData } from './ai-stream.util';
import {
  buildResponsesUrl,
  parseResponsesOutput,
  ResponsesResponse,
  ResponsesStreamAccumulator,
  toResponsesInput,
  toResponsesTools,
} from './ai-responses.util';

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

/** Request body for the provider's API type. */
export const buildRequestBody = (
  provider: AiProvider,
  req: AiChatRequest,
  isWithTemperature = true,
): Record<string, unknown> => {
  const isStream = !!req.onTextDelta;
  const temperature =
    isWithTemperature && typeof req.temperature === 'number'
      ? { temperature: req.temperature }
      : {};
  if (provider.apiType === 'responses') {
    return {
      model: provider.model,
      ...toResponsesInput(req.messages),
      stream: isStream,
      // Nothing is kept server side; every request carries the full history
      store: false,
      ...(req.tools?.length ? { tools: toResponsesTools(req.tools) } : {}),
      ...(req.isJsonResponse ? { text: { format: { type: 'json_object' } } } : {}),
      ...temperature,
    };
  }
  return {
    model: provider.model,
    messages: req.messages,
    stream: isStream,
    ...(req.tools?.length ? { tools: req.tools } : {}),
    ...(req.isJsonResponse ? { response_format: { type: 'json_object' } } : {}),
    ...temperature,
  };
};

/**
 * Minimal multi-provider chat client: OpenAI-compatible Chat Completions
 * (DeepSeek, Qwen, Kimi, OpenRouter, Ollama, OpenAI…) and the OpenAI Responses
 * API. Desktop-only: Electron strips CORS for renderer fetches.
 */
@Injectable({ providedIn: 'root' })
export class AiClientService {
  private readonly _settingsService = inject(AiSettingsService);

  async chat(req: AiChatRequest): Promise<AiChatResult> {
    const settings = await this._settingsService.load();
    const provider = resolveProvider(settings, req.providerId, req.feature);
    if (!provider) {
      throw new AiRequestError('AI is not configured');
    }
    return this.chatWithProvider(provider, req);
  }

  /**
   * Non-streamed request in JSON mode, returning the raw content. Some
   * providers reject the JSON mode parameter; retries plain then.
   */
  async chatJson(
    req: Omit<AiChatRequest, 'isJsonResponse' | 'onTextDelta'>,
  ): Promise<string> {
    try {
      return (await this.chat({ ...req, isJsonResponse: true })).content;
    } catch (e) {
      if (e instanceof AiRequestError && e.status === 400) {
        return (await this.chat(req)).content;
      }
      throw e;
    }
  }

  async chatWithProvider(
    provider: AiProvider,
    req: AiChatRequest,
  ): Promise<AiChatResult> {
    if (!isProviderConfigured(provider)) {
      throw new AiRequestError('AI is not configured');
    }
    try {
      return await this._send(provider, req, true);
    } catch (e) {
      // Reasoning models (o-series, gpt-5…) reject a custom temperature
      if (
        e instanceof AiRequestError &&
        e.status === 400 &&
        typeof req.temperature === 'number' &&
        /temperature/i.test(e.message)
      ) {
        return this._send(provider, req, false);
      }
      throw e;
    }
  }

  private async _send(
    provider: AiProvider,
    req: AiChatRequest,
    isWithTemperature: boolean,
  ): Promise<AiChatResult> {
    const isResponses = provider.apiType === 'responses';
    const isStream = !!req.onTextDelta;
    const body = buildRequestBody(provider, req, isWithTemperature);

    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = req.signal
      ? AbortSignal.any([req.signal, timeoutSignal])
      : timeoutSignal;

    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    if (provider.apiKey) {
      headers.set('Authorization', `Bearer ${provider.apiKey}`);
    }

    let res: Response;
    try {
      res = await fetch(
        isResponses
          ? buildResponsesUrl(provider.baseUrl)
          : buildChatCompletionsUrl(provider.baseUrl),
        { method: 'POST', headers, body: JSON.stringify(body), signal },
      );
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
      if (isResponses) {
        return parseResponsesOutput((await res.json()) as ResponsesResponse);
      }
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

    // Both accumulators take a parsed SSE chunk and return its text delta
    const acc: { push: (chunk: never) => string; result: () => AiChatResult } =
      isResponses ? new ResponsesStreamAccumulator() : new AiStreamAccumulator();
    for await (const data of readSseData(res.body)) {
      let chunk: never;
      try {
        chunk = JSON.parse(data) as never;
      } catch {
        continue;
      }
      let delta: string;
      try {
        delta = acc.push(chunk);
      } catch (e) {
        throw new AiRequestError((e as Error).message);
      }
      if (delta) {
        req.onTextDelta?.(delta);
      }
    }
    return acc.result();
  }
}

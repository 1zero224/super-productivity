import {
  buildResponsesUrl,
  parseResponsesOutput,
  ResponsesStreamAccumulator,
  toResponsesInput,
  toResponsesTools,
} from './ai-responses.util';
import { buildRequestBody } from './ai-client.service';
import { AiProvider } from './ai-client.model';

const provider = (apiType: AiProvider['apiType']): AiProvider => ({
  id: 'p',
  name: 'P',
  apiType,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-x',
  apiKey: 'k',
});

describe('Responses API adapter', () => {
  it('builds the endpoint url', () => {
    expect(buildResponsesUrl('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/responses',
    );
    expect(buildResponsesUrl('https://x/v1/responses')).toBe('https://x/v1/responses');
  });

  it('turns system messages into instructions and tool turns into items', () => {
    const res = toResponsesInput([
      { role: 'system', content: 'Be brief' },
      { role: 'user', content: 'Plan my day' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'list_tasks', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: '[]' },
      { role: 'assistant', content: 'Nothing planned' },
    ]);
    expect(res).toEqual({
      instructions: 'Be brief',
      input: [
        { role: 'user', content: 'Plan my day' },
        { type: 'function_call', call_id: 'c1', name: 'list_tasks', arguments: '{}' },
        { type: 'function_call_output', call_id: 'c1', output: '[]' },
        { role: 'assistant', content: 'Nothing planned' },
      ],
    });
  });

  it('flattens tool definitions', () => {
    expect(
      toResponsesTools([
        {
          type: 'function',
          function: { name: 'a', description: 'd', parameters: { type: 'object' } },
        },
      ]),
    ).toEqual([
      { type: 'function', name: 'a', description: 'd', parameters: { type: 'object' } },
    ]);
  });

  it('parses text and function calls of a response', () => {
    const res = parseResponsesOutput({
      status: 'completed',
      output: [
        { type: 'reasoning' },
        {
          type: 'message',
          content: [
            { type: 'output_text', text: 'Hi ' },
            { type: 'output_text', text: 'there' },
          ],
        },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'get_task',
          arguments: '{"id":"a"}',
        },
      ],
    });
    expect(res.content).toBe('Hi there');
    expect(res.toolCalls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'get_task', arguments: '{"id":"a"}' },
      },
    ]);
    expect(res.finishReason).toBe('tool_calls');
  });

  it('streams text deltas and takes the final response as the result', () => {
    const acc = new ResponsesStreamAccumulator();
    expect(acc.push({ type: 'response.output_text.delta', delta: 'He' })).toBe('He');
    expect(acc.push({ type: 'response.output_text.delta', delta: 'llo' })).toBe('llo');
    acc.push({
      type: 'response.completed',
      response: {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello' }] }],
      },
    });
    expect(acc.result()).toEqual({
      content: 'Hello',
      toolCalls: [],
      finishReason: 'stop',
    });
  });

  it('falls back to finished items and surfaces stream errors', () => {
    const acc = new ResponsesStreamAccumulator();
    acc.push({
      type: 'response.output_item.done',
      item: { type: 'function_call', call_id: 'c', name: 'mark_done', arguments: '{}' },
    });
    expect(acc.result().toolCalls.length).toBe(1);
    expect(() =>
      new ResponsesStreamAccumulator().push({ type: 'error', message: 'boom' }),
    ).toThrowError('boom');
  });
});

describe('buildRequestBody', () => {
  const req = {
    messages: [
      { role: 'system' as const, content: 'S' },
      { role: 'user' as const, content: 'U' },
    ],
    isJsonResponse: true,
    temperature: 0.3,
  };

  it('uses the chat completions shape', () => {
    expect(buildRequestBody(provider('chat'), req)).toEqual({
      model: 'gpt-x',
      messages: req.messages,
      stream: false,
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });
  });

  it('uses the responses shape and can drop the temperature', () => {
    expect(buildRequestBody(provider('responses'), req, false)).toEqual({
      model: 'gpt-x',
      instructions: 'S',
      input: [{ role: 'user', content: 'U' }],
      stream: false,
      store: false,
      text: { format: { type: 'json_object' } },
    });
  });
});

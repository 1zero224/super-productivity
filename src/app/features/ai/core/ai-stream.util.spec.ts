import { AiStreamAccumulator, extractJsonObject, readSseData } from './ai-stream.util';

const streamOf = (...parts: string[]): ReadableStream<Uint8Array> => {
  const enc = new TextEncoder();
  return new ReadableStream({
    start: (ctrl) => {
      parts.forEach((p) => ctrl.enqueue(enc.encode(p)));
      ctrl.close();
    },
  });
};

const collect = async (gen: AsyncGenerator<string>): Promise<string[]> => {
  const out: string[] = [];
  for await (const v of gen) {
    out.push(v);
  }
  return out;
};

describe('ai-stream.util', () => {
  describe('AiStreamAccumulator', () => {
    it('concatenates content deltas and returns them', () => {
      const acc = new AiStreamAccumulator();
      expect(acc.push({ choices: [{ delta: { content: 'Hel' } }] })).toBe('Hel');
      expect(acc.push({ choices: [{ delta: { content: 'lo' } }] })).toBe('lo');
      acc.push({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      expect(acc.result()).toEqual({
        content: 'Hello',
        toolCalls: [],
        finishReason: 'stop',
      });
    });

    it('assembles tool calls from fragments by index', () => {
      const acc = new AiStreamAccumulator();
      acc.push({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'c1', type: 'function', function: { name: 'get_task' } },
              ],
            },
          },
        ],
      });
      acc.push({
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: '{"id":' } }] } },
        ],
      });
      acc.push({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '"t1"}' } },
                { index: 1, id: 'c2', function: { name: 'mark_done', arguments: '{}' } },
              ],
            },
          },
        ],
      });
      expect(acc.result().toolCalls).toEqual([
        {
          id: 'c1',
          type: 'function',
          function: { name: 'get_task', arguments: '{"id":"t1"}' },
        },
        { id: 'c2', type: 'function', function: { name: 'mark_done', arguments: '{}' } },
      ]);
    });
  });

  describe('readSseData', () => {
    it('yields data payloads across chunk boundaries and stops at [DONE]', async () => {
      const out = await collect(
        readSseData(
          streamOf('data: {"a":1}\n\nda', 'ta: {"b":2}\n\n', 'data: [DONE]\n\ndata: x\n'),
        ),
      );
      expect(out).toEqual(['{"a":1}', '{"b":2}']);
    });

    it('ignores comments and handles a trailing line without newline', async () => {
      const out = await collect(readSseData(streamOf(': keep-alive\n', 'data: {"c":3}')));
      expect(out).toEqual(['{"c":3}']);
    });
  });

  describe('extractJsonObject', () => {
    it('parses plain JSON', () => {
      expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    });

    it('parses a fenced json block', () => {
      expect(extractJsonObject('Here:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    });

    it('parses the outermost object inside prose', () => {
      expect(extractJsonObject('Sure! {"a":{"b":3}} done')).toEqual({ a: { b: 3 } });
    });

    it('throws when there is no JSON', () => {
      expect(() => extractJsonObject('nope')).toThrowError(/valid JSON/);
    });
  });
});

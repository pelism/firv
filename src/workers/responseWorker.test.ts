import { describe, expect, it } from 'vitest';
import { parseAndFilterResponse } from './responseWorker';

describe('parseAndFilterResponse', () => {
  it('parses valid JSON without filtering', () => {
    const result = parseAndFilterResponse('{"name":"firv","nested":{"count":2}}', '');

    expect(result).toEqual({
      parsed: {
        name: 'firv',
        nested: { count: 2 },
      },
    });
  });

  it('applies a JMESPath query when provided', () => {
    const result = parseAndFilterResponse(
      '{"users":[{"name":"Ada"},{"name":"Linus"}]}',
      'users[0].name'
    );

    expect(result).toEqual({ parsed: 'Ada' });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseAndFilterResponse('not-json', '')).toThrow();
  });
});

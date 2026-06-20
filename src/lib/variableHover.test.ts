import { describe, expect, it } from 'vitest';
import {
  buildSingleVariableHoverTitle,
  buildVariableHoverTitle,
  extractTemplateVariableNames,
  normalizeVariableLookup,
} from './variableHover';

describe('variableHover', () => {
  it('normalizes enabled workspace variables into a lowercase lookup', () => {
    expect(
      normalizeVariableLookup([
        { key: 'Token', value: 'abc123', enabled: true },
        { key: 'Disabled', value: 'ignored', enabled: false },
      ])
    ).toEqual({ token: 'abc123' });
  });

  it('extracts template variable names from templated text', () => {
    expect(extractTemplateVariableNames('https://example.test/{{Token}}?q={{query}}')).toEqual(['Token', 'query']);
  });

  it('builds hover titles for known global variables only', () => {
    const lookup = normalizeVariableLookup([{ key: 'token', value: 'abc123', enabled: true }]);

    expect(buildVariableHoverTitle('Bearer {{token}}', lookup)).toBe('Bearer abc123');
    expect(buildVariableHoverTitle('Bearer {{missing}}', lookup)).toBeUndefined();
    expect(buildSingleVariableHoverTitle('token', lookup)).toBe('abc123');
  });

  it('expands embedded variables recursively inside hover text', () => {
    const lookup = normalizeVariableLookup([
      { key: 'root', value: 'localhost', enabled: true },
      { key: 'baseUrl', value: 'http://{{root}}/test', enabled: true },
    ]);

    expect(buildSingleVariableHoverTitle('baseUrl', lookup)).toBe('http://localhost/test');
    expect(buildVariableHoverTitle('{{baseUrl}}', lookup)).toBe('http://localhost/test');
  });
});

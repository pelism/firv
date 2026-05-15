import { describe, expect, it } from 'vitest';
import {
  getFormattedAuthorizationHeader,
  getFormattedBody,
  getFormattedRequest,
  getHydratedBodySnapshot,
  getHydratedFormBodySnapshot,
  normalizeBodyMode,
  normalizeExtractionTarget,
  resolveRequestDisplayName,
  resolveRequestIdByName,
  flattenRequestOptions,
} from './requestEditorUtils';

describe('requestEditorUtils', () => {
  it('normalizes body modes', () => {
    expect(normalizeBodyMode('formdata')).toBe('form');
    expect(normalizeBodyMode(undefined)).toBe('json');
    expect(normalizeBodyMode('none')).toBe('none');
    expect(normalizeBodyMode('json')).toBe('json');
    expect(normalizeBodyMode('raw')).toBe('raw');
  });

  it('hydrates body snapshots', () => {
    expect(getHydratedBodySnapshot(undefined)).toBe('');
    expect(getHydratedBodySnapshot({ mode: 'formdata', data: 'x' })).toBe('');
    expect(getHydratedBodySnapshot({ mode: 'json', data: '{"a":1}' })).toBe('{"a":1}');
    expect(getHydratedBodySnapshot({ mode: 'raw', data: 'abc' })).toBe('abc');
  });

  it('hydrates form body snapshots', () => {
    expect(getHydratedFormBodySnapshot(undefined)).toEqual([]);
    expect(getHydratedFormBodySnapshot({ mode: 'json', data: [] })).toEqual([]);
    expect(getHydratedFormBodySnapshot({ mode: 'formdata', data: [{ key: 'a', value: '1', enabled: true }] })).toEqual([
      { key: 'a', value: '1', enabled: true },
    ]);
  });

  it('formats body payloads', () => {
    expect(getFormattedBody('none', '', [])).toEqual({ mode: 'none' });
    expect(getFormattedBody('form', '', [{ key: 'a', value: '1', enabled: true }])).toEqual({
      mode: 'formdata',
      data: [{ key: 'a', value: '1', enabled: true }],
    });
    expect(getFormattedBody('json', '{"a":1}', [])).toEqual({ mode: 'json', data: '{"a":1}' });
    expect(getFormattedBody('raw', 'abc', [])).toEqual({ mode: 'raw', data: 'abc' });
  });

  it('formats request payloads', () => {
    expect(
      getFormattedRequest({
        requestId: 'req-1',
        requestName: 'Folder/Req',
        method: 'POST',
        url: 'https://example.test',
        headers: [{ key: 'X-Test', value: '1', enabled: true }],
        authorization: { mode: 'none', value: '' },
        params: [{ key: 'q', value: 'firv', enabled: true }],
        bodyMode: 'raw',
        body: 'hello',
        formBody: [],
        templateText: '   ',
        extractions: [{ target: 'token', source: 'response_body_json', pattern: '$.token' }],
        beforeRunChain: [{ request_id: '' }, { request_id: 'req-2' }],
        chainSteps: [{ when: 'on_success', next_request_id: '' }, { when: 'on_failure', next_request_id: 'req-3' }],
      })
    ).toEqual({
      id: 'req-1',
      name: 'Folder/Req',
      method: 'POST',
      url: 'https://example.test',
      headers: [{ key: 'X-Test', value: '1', enabled: true }],
      params: [{ key: 'q', value: 'firv', enabled: true }],
      body: { mode: 'raw', data: 'hello' },
      transforms: {
        pre_request_template: null,
        response_extractions: [{ target: 'token', source: 'response_body_json', pattern: '$.token' }],
        before_run: [{ request_id: 'req-2' }],
        chain_steps: [{ when: 'on_failure', next_request_id: 'req-3' }],
      },
    });
  });

  it('normalizes extraction targets', () => {
    expect(normalizeExtractionTarget('token')).toBe('token');
    expect(normalizeExtractionTarget('{{ token }}')).toBe('token');
    expect(normalizeExtractionTarget('{{token}}')).toBe('token');
  });

  it('strips braces from extraction targets when formatting requests', () => {
    expect(
      getFormattedRequest({
        requestId: 'req-1',
        requestName: 'Folder/Req',
        method: 'POST',
        url: 'https://example.test',
        headers: [],
        authorization: { mode: 'none', value: '' },
        params: [],
        bodyMode: 'none',
        body: '',
        formBody: [],
        templateText: '',
        extractions: [{ target: '{{ token }}', source: 'response_body_json', pattern: '$.token' }],
        beforeRunChain: [],
        chainSteps: [],
      }).transforms.response_extractions
    ).toEqual([{ target: 'token', source: 'response_body_json', pattern: '$.token' }]);
  });

  it('formats authorization headers', () => {
    expect(getFormattedAuthorizationHeader({ mode: 'none', value: '' })).toBeNull();
    expect(getFormattedAuthorizationHeader({ mode: 'bearer', value: '{{token}}' })).toEqual({
      key: 'Authorization',
      value: 'Bearer {{token}}',
      enabled: true,
    });
    expect(getFormattedAuthorizationHeader({ mode: 'bearer', value: 'plain-token' })).toEqual({
      key: 'Authorization',
      value: 'Bearer plain-token',
      enabled: true,
    });
  });

  it('injects authorization into formatted requests', () => {
    expect(
      getFormattedRequest({
        requestId: 'req-1',
        requestName: 'Folder/Req',
        method: 'GET',
        url: 'https://example.test',
        headers: [{ key: 'X-Test', value: '1', enabled: true }, { key: 'Authorization', value: 'Bearer old', enabled: true }],
        authorization: { mode: 'bearer', value: '{{token}}' },
        params: [],
        bodyMode: 'none',
        body: '',
        formBody: [],
        templateText: '',
        extractions: [],
        beforeRunChain: [],
        chainSteps: [],
      }).headers
    ).toEqual([
      { key: 'X-Test', value: '1', enabled: true },
      { key: 'Authorization', value: 'Bearer {{token}}', enabled: true },
    ]);
  });

  it('flattens request options', () => {
    expect(
      flattenRequestOptions([
        { kind: { type: 'folder', name: 'Folder', items: [{ kind: { type: 'request', id: '1', name: 'Req' } }] } } as any,
      ])
    ).toEqual([{ id: '1', name: 'Folder/Req' }]);
  });

  it('resolves request ids and display names', () => {
    const options = [{ id: '1', name: 'Folder/Req' }, { id: '2', name: 'Other' }];
    expect(resolveRequestIdByName(options, 'Folder/Req')).toBe('1');
    expect(resolveRequestIdByName(options, 'Req')).toBe('1');
    expect(resolveRequestIdByName(options, 'missing')).toBe('');
    expect(resolveRequestDisplayName(options, '1')).toBe('Folder/Req');
    expect(resolveRequestDisplayName(options, 'Req')).toBe('Folder/Req');
    expect(resolveRequestDisplayName(options, 'missing')).toBe('missing');
  });
});

import type { HydratedSidebarItem } from '../types/hydratedSidebarItem.ts';
import type { BeforeRunStep } from '../types/beforeRunStep';
import type { RequestExtractionRule } from '../types/requestExtractionRule';
import type { RequestChainStep } from '../types/requestChainStep';
import type { KeyValue } from '../types/keyValue';

export interface RequestOption {
  id: string;
  name: string;
}

export const flattenRequestOptions = (items: HydratedSidebarItem[], prefix: string[] = []): RequestOption[] => {
  const result: RequestOption[] = [];
  for (const item of items) {
    if (item.kind.type === 'request') {
      result.push({ id: item.kind.id, name: [...prefix, item.kind.name].join('/') });
    } else if (item.kind.type === 'folder') {
      result.push(...flattenRequestOptions(item.kind.items, [...prefix, item.kind.name]));
    }
  }
  return result;
};

export const normalizeBodyMode = (mode: string | undefined) => {
  if (mode === 'formdata') return 'form' as const;
  return (mode || 'json') as 'none' | 'form' | 'json' | 'raw';
};

export const getHydratedBodySnapshot = (reqBody: any) => {
  if (!reqBody) return '';
  if (reqBody.mode === 'formdata') return '';
  return reqBody.data || '';
};

export const getHydratedFormBodySnapshot = (reqBody: any): KeyValue[] => {
  if (!reqBody || reqBody.mode !== 'formdata' || !Array.isArray(reqBody.data)) return [];
  return reqBody.data.map((h: any) => ({ key: h.key, value: h.value, enabled: h.enabled }));
};

export const getTransformsState = (
  templateText: string,
  extractions: RequestExtractionRule[],
  beforeRunChain: BeforeRunStep[],
  chainSteps: RequestChainStep[],
) => ({
  pre_request_template: templateText,
  response_extractions: extractions,
  before_run: beforeRunChain.map(step => ({ request_id: step.request_id })),
  chain_steps: chainSteps.map(step => ({ when: step.when, next_request_id: step.next_request_id })),
});

export const getFormattedBody = (bodyMode: 'none' | 'form' | 'json' | 'raw', body: string, formBody: KeyValue[]) => {
  if (bodyMode === 'none') return { mode: 'none' as const };
  if (bodyMode === 'form') return { mode: 'formdata' as const, data: formBody.map(({ key, value, enabled }) => ({ key, value, enabled })) };
  if (bodyMode === 'json') return { mode: 'json' as const, data: body };
  return { mode: 'raw' as const, data: body };
};

export const getFormattedRequest = (args: {
  requestId: string;
  requestName: string;
  method: string;
  url: string;
  headers: KeyValue[];
  params: KeyValue[];
  bodyMode: 'none' | 'form' | 'json' | 'raw';
  body: string;
  formBody: KeyValue[];
  templateText: string;
  extractions: RequestExtractionRule[];
  beforeRunChain: BeforeRunStep[];
  chainSteps: RequestChainStep[];
}) => ({
  id: args.requestId,
  name: args.requestName,
  method: args.method,
  url: args.url,
  headers: args.headers.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })),
  params: args.params.map(p => ({ key: p.key, value: p.value, enabled: p.enabled })),
  body: getFormattedBody(args.bodyMode, args.body, args.formBody),
  transforms: {
    pre_request_template: args.templateText.trim() || null,
    response_extractions: args.extractions,
    before_run: args.beforeRunChain.filter(step => step.request_id.trim()),
    chain_steps: args.chainSteps.filter(step => step.next_request_id.trim()),
  }
});

export const resolveRequestIdByName = (requestOptions: RequestOption[], value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const match = requestOptions.find(option => option.name === trimmed || option.name.split('/').pop() === trimmed);
  return match?.id || '';
};

export const resolveRequestDisplayName = (requestOptions: RequestOption[], idOrName: string) => {
  const trimmed = idOrName.trim();
  if (!trimmed) return '';
  const byId = requestOptions.find(option => option.id === trimmed);
  if (byId) return byId.name;
  const byName = requestOptions.find(option => option.name === trimmed || option.name.split('/').pop() === trimmed);
  return byName?.name || trimmed;
};

export const getRequestDisplayName = (requestOptions: RequestOption[], getRequestName: (id: string) => string, id: string) => {
  const found = requestOptions.find(option => option.id === id);
  return found?.name || getRequestName(id);
};

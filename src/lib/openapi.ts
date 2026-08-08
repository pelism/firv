import { load as loadYaml } from 'js-yaml';
import type { KeyValue } from '../types/keyValue';
import type { RequestVariable } from '../types/requestVariable';
import type { RequestBody } from '../types/requestBody';
import type { HttpMethod } from '../types/httpMethod';

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;
type LowerHttpMethod = typeof HTTP_METHODS[number];

export interface OpenApiDoc {
  version: 2 | 3;
  baseUrl: string;
  paths: Record<string, Record<string, any>>;
  raw: any;
}

export interface OpenApiOperationSummary {
  key: string;
  path: string;
  method: LowerHttpMethod;
  operationId?: string;
  summary?: string;
  tags: string[];
}

export interface BuiltFirvRequest {
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  params: KeyValue[];
  body: RequestBody;
  requestVariables: RequestVariable[];
}

export function parseSpec(content: string): OpenApiDoc {
  let raw: any;
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    raw = JSON.parse(content);
  } else {
    try {
      raw = JSON.parse(content);
    } catch {
      raw = loadYaml(content);
    }
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid OpenAPI/Swagger document');
  }

  const isV3 = typeof raw.openapi === 'string' && raw.openapi.startsWith('3');
  const isV2 = raw.swagger === '2.0';

  if (!isV3 && !isV2) {
    throw new Error('Unsupported document: expected an OpenAPI 3.x or Swagger 2.0 spec');
  }

  const version: 2 | 3 = isV3 ? 3 : 2;
  const baseUrl = version === 3 ? resolveV3BaseUrl(raw) : resolveV2BaseUrl(raw);
  const paths = raw.paths && typeof raw.paths === 'object' ? raw.paths : {};

  return { version, baseUrl, paths, raw };
}

function resolveV3BaseUrl(raw: any): string {
  const servers = Array.isArray(raw.servers) ? raw.servers : [];
  const url = servers[0]?.url;
  return typeof url === 'string' ? url.replace(/\/$/, '') : '';
}

function resolveV2BaseUrl(raw: any): string {
  const scheme = Array.isArray(raw.schemes) && raw.schemes.length > 0 ? raw.schemes[0] : 'https';
  const host = typeof raw.host === 'string' ? raw.host : '';
  const basePath = typeof raw.basePath === 'string' ? raw.basePath : '';
  if (!host) return basePath.replace(/\/$/, '');
  return `${scheme}://${host}${basePath}`.replace(/\/$/, '');
}

export function listOperations(doc: OpenApiDoc): OpenApiOperationSummary[] {
  const operations: OpenApiOperationSummary[] = [];

  for (const [path, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;
      operations.push({
        key: `${method}:${path}`,
        path,
        method,
        operationId: operation.operationId,
        summary: operation.summary || operation.description,
        tags: Array.isArray(operation.tags) && operation.tags.length > 0 ? operation.tags : [],
      });
    }
  }

  return operations;
}

export function resolveRef(doc: OpenApiDoc, ref: string): any {
  if (!ref.startsWith('#/')) return undefined;
  const parts = ref.slice(2).split('/').map(decodeRefSegment);
  let current: any = doc.raw;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function decodeRefSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveSchema(schema: any, doc: OpenApiDoc): any {
  if (schema && typeof schema === 'object' && typeof schema.$ref === 'string') {
    const resolved = resolveRef(doc, schema.$ref);
    return resolved ?? {};
  }
  return schema;
}

const MAX_EXAMPLE_DEPTH = 6;

export function generateExample(schemaInput: any, doc: OpenApiDoc, depth = 0): unknown {
  const schema = resolveSchema(schemaInput, doc);
  if (!schema || typeof schema !== 'object') return null;

  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;

  if (depth >= MAX_EXAMPLE_DEPTH) {
    return schema.type === 'array' ? [] : schema.type === 'object' ? {} : null;
  }

  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce((acc: any, sub: any) => {
      const value = generateExample(sub, doc, depth + 1);
      return value && typeof value === 'object' && !Array.isArray(value)
        ? { ...acc, ...value }
        : acc;
    }, {});
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return generateExample(schema.oneOf[0], doc, depth + 1);
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return generateExample(schema.anyOf[0], doc, depth + 1);
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  const type = schema.type ?? (schema.properties ? 'object' : undefined);

  switch (type) {
    case 'string':
      return generateStringExample(schema);
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return true;
    case 'array':
      return [generateExample(schema.items ?? {}, doc, depth + 1)];
    case 'object':
      return generateObjectExample(schema, doc, depth);
    default:
      if (schema.properties) return generateObjectExample(schema, doc, depth);
      return null;
  }
}

function generateStringExample(schema: any): string {
  switch (schema.format) {
    case 'date-time':
      return new Date(0).toISOString();
    case 'date':
      return new Date(0).toISOString().slice(0, 10);
    case 'email':
      return 'user@example.com';
    case 'uuid':
      return '00000000-0000-0000-0000-000000000000';
    case 'byte':
    case 'binary':
      return '';
    default:
      return 'string';
  }
}

function generateObjectExample(schema: any, doc: OpenApiDoc, depth: number): Record<string, unknown> {
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];
  const keys = Object.keys(properties);
  const orderedKeys = [...required.filter(k => keys.includes(k)), ...keys.filter(k => !required.includes(k))];

  const result: Record<string, unknown> = {};
  for (const key of orderedKeys) {
    result[key] = generateExample(properties[key], doc, depth + 1);
  }
  return result;
}

interface NormalizedParameter {
  name: string;
  in: string;
  required: boolean;
  schema: any;
}

function collectParameters(doc: OpenApiDoc, path: string, method: LowerHttpMethod): NormalizedParameter[] {
  const pathItem = doc.paths[path] ?? {};
  const operation = pathItem[method] ?? {};
  const pathLevel = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
  const opLevel = Array.isArray(operation.parameters) ? operation.parameters : [];

  const merged = new Map<string, any>();
  for (const raw of [...pathLevel, ...opLevel]) {
    const param = resolveSchema(raw, doc);
    if (!param || !param.name || !param.in) continue;
    merged.set(`${param.in}:${param.name}`, param);
  }

  return Array.from(merged.values()).map(param => ({
    name: param.name,
    in: param.in,
    required: Boolean(param.required),
    schema: param.schema ?? param,
  }));
}

function resolveRequestBodySchema(doc: OpenApiDoc, path: string, method: LowerHttpMethod): {
  mediaType: string;
  schema: any;
} | null {
  const operation = doc.paths[path]?.[method] ?? {};

  if (doc.version === 3) {
    const requestBody = resolveSchema(operation.requestBody, doc);
    const content = requestBody?.content;
    if (!content || typeof content !== 'object') return null;

    const mediaType = content['application/json']
      ? 'application/json'
      : content['multipart/form-data']
        ? 'multipart/form-data'
        : content['application/x-www-form-urlencoded']
          ? 'application/x-www-form-urlencoded'
          : Object.keys(content)[0];

    if (!mediaType) return null;
    return { mediaType, schema: content[mediaType]?.schema ?? {} };
  }

  const params = collectParameters(doc, path, method);
  const bodyParam = params.find(p => p.in === 'body');
  if (bodyParam) {
    return { mediaType: 'application/json', schema: bodyParam.schema };
  }

  const formParams = params.filter(p => p.in === 'formData');
  if (formParams.length > 0) {
    return {
      mediaType: 'multipart/form-data',
      schema: {
        type: 'object',
        properties: Object.fromEntries(formParams.map(p => [p.name, p.schema])),
        required: formParams.filter(p => p.required).map(p => p.name),
      },
    };
  }

  return null;
}

function buildBody(doc: OpenApiDoc, path: string, method: LowerHttpMethod): { body: RequestBody; contentTypeHeader?: string } {
  const resolved = resolveRequestBodySchema(doc, path, method);
  if (!resolved) return { body: { mode: 'none' } };

  const { mediaType, schema } = resolved;

  if (mediaType === 'application/json') {
    const example = generateExample(schema, doc);
    return {
      body: { mode: 'json', data: JSON.stringify(example, null, 2) },
      contentTypeHeader: 'application/json',
    };
  }

  if (mediaType === 'multipart/form-data' || mediaType === 'application/x-www-form-urlencoded') {
    const resolvedSchema = resolveSchema(schema, doc);
    const properties = resolvedSchema?.properties && typeof resolvedSchema.properties === 'object' ? resolvedSchema.properties : {};
    const data: KeyValue[] = Object.entries(properties).map(([key, propSchema]) => ({
      key,
      value: String(generateExample(propSchema, doc) ?? ''),
      enabled: true,
    }));
    return { body: { mode: 'formdata', data } };
  }

  const example = generateExample(schema, doc);
  return { body: { mode: 'raw', data: typeof example === 'string' ? example : JSON.stringify(example, null, 2) } };
}

export function buildFirvRequest(
  doc: OpenApiDoc,
  path: string,
  method: LowerHttpMethod,
  summary?: OpenApiOperationSummary
): BuiltFirvRequest {
  const operation = doc.paths[path]?.[method] ?? {};
  const parameters = collectParameters(doc, path, method);

  const pathParams = parameters.filter(p => p.in === 'path');
  const queryParams = parameters.filter(p => p.in === 'query');
  const headerParams = parameters.filter(p => p.in === 'header');

  let url = `${doc.baseUrl}${path}`;
  for (const param of pathParams) {
    url = url.split(`{${param.name}}`).join(`{{${param.name}}}`);
  }

  const headers: KeyValue[] = headerParams.map(p => ({
    key: p.name,
    value: `{{${p.name}}}`,
    enabled: p.required,
  }));

  const params: KeyValue[] = queryParams.map(p => ({
    key: p.name,
    value: `{{${p.name}}}`,
    enabled: p.required,
  }));

  const { body, contentTypeHeader } = buildBody(doc, path, method);
  if (contentTypeHeader && !headers.some(h => h.key.toLowerCase() === 'content-type')) {
    headers.push({ key: 'Content-Type', value: contentTypeHeader, enabled: true });
  }

  const requestVariables: RequestVariable[] = [...pathParams, ...queryParams]
    .map(p => ({
      key: p.name,
      value: p.schema?.default !== undefined ? String(p.schema.default) : '',
      secret_ref: null,
    }))
    .filter((v, index, arr) => arr.findIndex(other => other.key === v.key) === index);

  const name = summary?.summary || operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`;

  return {
    name,
    method: method.toUpperCase() as HttpMethod,
    url,
    headers,
    params,
    body,
    requestVariables,
  };
}

import { describe, expect, it } from 'vitest';
import { buildFirvRequest, generateExample, listOperations, parseSpec } from './openapi';

const openApi3Spec = {
  openapi: '3.0.0',
  info: { title: 'Pet Store', version: '1.0' },
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        summary: 'Get a pet',
        tags: ['Pets'],
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'verbose', in: 'query', required: false, schema: { type: 'boolean' } },
          { name: 'X-Trace-Id', in: 'header', required: false, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
      post: {
        operationId: 'updatePet',
        summary: 'Update a pet',
        tags: ['Pets'],
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Pet' },
            },
          },
        },
        responses: { '200': { description: 'OK' } },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' },
          tags: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['available', 'pending', 'sold'] },
        },
      },
    },
  },
};

const swaggerSpec = {
  swagger: '2.0',
  info: { title: 'Legacy API', version: '1.0' },
  host: 'legacy.example.com',
  basePath: '/api',
  schemes: ['https'],
  paths: {
    '/items': {
      post: {
        operationId: 'createItem',
        tags: ['Items'],
        parameters: [
          {
            name: 'body',
            in: 'body',
            required: true,
            schema: { $ref: '#/definitions/Item' },
          },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
  definitions: {
    Item: {
      type: 'object',
      properties: {
        title: { type: 'string' },
      },
    },
  },
};

describe('parseSpec', () => {
  it('parses OpenAPI 3 JSON and resolves base url from servers', () => {
    const doc = parseSpec(JSON.stringify(openApi3Spec));
    expect(doc.version).toBe(3);
    expect(doc.baseUrl).toBe('https://api.example.com/v1');
  });

  it('parses Swagger 2.0 and resolves base url from host/basePath/schemes', () => {
    const doc = parseSpec(JSON.stringify(swaggerSpec));
    expect(doc.version).toBe(2);
    expect(doc.baseUrl).toBe('https://legacy.example.com/api');
  });

  it('throws on unsupported documents', () => {
    expect(() => parseSpec(JSON.stringify({ foo: 'bar' }))).toThrow();
  });
});

describe('listOperations', () => {
  it('flattens paths/methods into a summary list', () => {
    const doc = parseSpec(JSON.stringify(openApi3Spec));
    const ops = listOperations(doc);
    expect(ops).toHaveLength(2);
    expect(ops.map(o => o.key)).toEqual(expect.arrayContaining(['get:/pets/{petId}', 'post:/pets/{petId}']));
    expect(ops[0].tags).toEqual(['Pets']);
  });
});

describe('generateExample', () => {
  it('synthesizes example values by type, respecting enum/required ordering', () => {
    const doc = parseSpec(JSON.stringify(openApi3Spec));
    const example = generateExample({ $ref: '#/components/schemas/Pet' }, doc) as Record<string, unknown>;
    expect(example.name).toBe('string');
    expect(example.age).toBe(0);
    expect(example.tags).toEqual(['string']);
    expect(example.status).toBe('available');
    expect(Object.keys(example)[0]).toBe('name');
  });
});

describe('buildFirvRequest', () => {
  it('builds a GET request with path/query/header params and request variables', () => {
    const doc = parseSpec(JSON.stringify(openApi3Spec));
    const built = buildFirvRequest(doc, '/pets/{petId}', 'get');

    expect(built.method).toBe('GET');
    expect(built.url).toBe('https://api.example.com/v1/pets/{{petId}}');
    expect(built.params).toEqual([{ key: 'verbose', value: '{{verbose}}', enabled: false }]);
    expect(built.headers).toEqual([{ key: 'X-Trace-Id', value: '{{X-Trace-Id}}', enabled: false }]);
    expect(built.requestVariables.map(v => v.key)).toEqual(expect.arrayContaining(['petId', 'verbose']));
  });

  it('builds a POST request with a JSON body generated from the schema', () => {
    const doc = parseSpec(JSON.stringify(openApi3Spec));
    const built = buildFirvRequest(doc, '/pets/{petId}', 'post');

    expect(built.body.mode).toBe('json');
    const parsedBody = JSON.parse((built.body as { mode: 'json'; data: string }).data);
    expect(parsedBody.name).toBe('string');
    expect(built.headers.some(h => h.key === 'Content-Type' && h.value === 'application/json')).toBe(true);
  });

  it('resolves Swagger 2.0 body parameters via #/definitions refs', () => {
    const doc = parseSpec(JSON.stringify(swaggerSpec));
    const built = buildFirvRequest(doc, '/items', 'post');

    expect(built.url).toBe('https://legacy.example.com/api/items');
    expect(built.body.mode).toBe('json');
    const parsedBody = JSON.parse((built.body as { mode: 'json'; data: string }).data);
    expect(parsedBody.title).toBe('string');
  });
});

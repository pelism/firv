import jmespath from 'jmespath';

export interface WorkerMessage {
  type: 'PARSE_AND_FILTER' | 'SEARCH';
  payload: any;
  id: number;
}

export interface WorkerResponse {
  type: 'SUCCESS' | 'ERROR';
  payload: any;
  id: number;
}

export function parseAndFilterResponse(body: string, jmesQuery: string) {
  let parsed = JSON.parse(body);
  if (jmesQuery && jmesQuery.trim() !== '') {
    parsed = jmespath.search(parsed, jmesQuery);
  }
  return { parsed };
}

if (typeof self !== 'undefined' && 'postMessage' in self) {
  self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const { type, payload, id } = e.data;
    
    try {
      if (type === 'PARSE_AND_FILTER') {
        const { body, jmesQuery } = payload;
        self.postMessage({ type: 'SUCCESS', payload: parseAndFilterResponse(body, jmesQuery), id });
      }
    } catch (err: any) {
      self.postMessage({ type: 'ERROR', payload: err.message, id });
    }
  };
}

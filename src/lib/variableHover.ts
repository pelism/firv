export type VariableLookup = Record<string, string>;

export interface TemplateVariableMatch {
  name: string;
  start: number;
  end: number;
}

const TEMPLATE_VARIABLE_REGEX = /\{\{\s*([a-zA-Z0-9_-]+)\s*}}/g;
const MAX_VARIABLE_EXPANSION_DEPTH = 10;

export const normalizeVariableKey = (key: string) => key.trim().toLowerCase();

export const normalizeVariableLookup = (
  variables: Array<{ key: string; value: string; enabled?: boolean }> | Record<string, string> | null | undefined,
): VariableLookup => {
  if (!variables) return {};

  if (Array.isArray(variables)) {
    return variables.reduce<VariableLookup>((acc, item) => {
      if (item.enabled === false) return acc;
      const key = item.key.trim();
      if (!key) return acc;
      acc[normalizeVariableKey(key)] = String(item.value ?? '');
      return acc;
    }, {});
  }

  return Object.entries(variables).reduce<VariableLookup>((acc, [key, value]) => {
    acc[normalizeVariableKey(key)] = String(value ?? '');
    return acc;
  }, {});
};

const resolveVariableText = (
  text: string,
  lookup: VariableLookup,
  seen: Set<string> = new Set(),
  depth = 0,
): { text: string; resolved: boolean } => {
  if (!text || depth >= MAX_VARIABLE_EXPANSION_DEPTH) return { text, resolved: false };

  TEMPLATE_VARIABLE_REGEX.lastIndex = 0;
  let allResolved = true;
  const resolvedText = text.replace(TEMPLATE_VARIABLE_REGEX, (match, variableName: string) => {
    const normalized = normalizeVariableKey(variableName);
    const value = lookup[normalized];
    if (value === undefined) {
      allResolved = false;
      return match;
    }
    if (seen.has(normalized)) return value;

    const nextSeen = new Set(seen);
    nextSeen.add(normalized);
    const nested = resolveVariableText(value, lookup, nextSeen, depth + 1);
    if (!nested.resolved) allResolved = false;
    return nested.text;
  });

  return { text: resolvedText, resolved: allResolved };
};

export const extractTemplateVariableNames = (text: string): string[] => {
  if (!text) return [];

  const result: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  TEMPLATE_VARIABLE_REGEX.lastIndex = 0;
  while ((match = TEMPLATE_VARIABLE_REGEX.exec(text)) !== null) {
    const normalized = normalizeVariableKey(match[1]);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(match[1]);
  }

  return result;
};

export const extractTemplateVariableMatches = (text: string): TemplateVariableMatch[] => {
  if (!text) return [];

  const result: TemplateVariableMatch[] = [];
  let match: RegExpExecArray | null;

  TEMPLATE_VARIABLE_REGEX.lastIndex = 0;
  while ((match = TEMPLATE_VARIABLE_REGEX.exec(text)) !== null) {
    result.push({
      name: match[1],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return result;
};

export const buildVariableHoverTitle = (text: string, lookup: VariableLookup): string | undefined => {
  const names = extractTemplateVariableNames(text);
  if (names.length === 0) return undefined;

  const resolved = resolveVariableText(text, lookup);
  return resolved.resolved ? resolved.text : undefined;
};

export const buildSingleVariableHoverTitle = (variableName: string, lookup: VariableLookup): string | undefined => {
  const value = lookup[normalizeVariableKey(variableName)];
  if (value === undefined) return undefined;

  const resolved = resolveVariableText(value, lookup);
  return resolved.resolved ? resolved.text : undefined;
};

const parsePixelValue = (value: string, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getFontForElement = (element: HTMLInputElement | HTMLTextAreaElement) => {
  const style = window.getComputedStyle(element);
  return style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
};

const getHoveredTemplateVariableAtPoint = (
  text: string,
  element: HTMLInputElement | HTMLTextAreaElement,
  clientX: number,
  clientY: number,
): TemplateVariableMatch | undefined => {
  const matches = extractTemplateVariableMatches(text);
  if (matches.length === 0) return undefined;

  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const paddingLeft = parsePixelValue(style.paddingLeft);
  const paddingTop = parsePixelValue(style.paddingTop);
  const fontSize = parsePixelValue(style.fontSize, 14);
  const lineHeight = parsePixelValue(style.lineHeight, fontSize * 1.2);
  const x = clientX - rect.left + element.scrollLeft - paddingLeft;
  const y = clientY - rect.top + element.scrollTop - paddingTop;
  const lineIndex = element instanceof HTMLTextAreaElement ? Math.max(0, Math.floor(y / lineHeight)) : 0;
  const lines = text.split('\n');

  if (lineIndex < 0 || lineIndex >= lines.length) return undefined;

  const lineText = lines[lineIndex];
  const lineStartOffset = lines.slice(0, lineIndex).reduce((sum, line) => sum + line.length + 1, 0);
  const lineMatches = matches.filter(match => match.start >= lineStartOffset && match.end <= lineStartOffset + lineText.length);
  if (lineMatches.length === 0) return undefined;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return undefined;

  context.font = getFontForElement(element);

  for (const match of lineMatches) {
    const relativeStart = match.start - lineStartOffset;
    const relativeEnd = match.end - lineStartOffset;
    const startX = context.measureText(lineText.slice(0, relativeStart)).width;
    const endX = context.measureText(lineText.slice(0, relativeEnd)).width;
    if (x >= startX && x <= endX) {
      return match;
    }
  }

  return undefined;
};

export const getVariableHoverTitleAtPoint = (
  text: string,
  lookup: VariableLookup,
  element: HTMLInputElement | HTMLTextAreaElement | null,
  clientX: number,
  clientY: number,
): string | undefined => {
  if (!element || !text) return undefined;

  const hovered = getHoveredTemplateVariableAtPoint(text, element, clientX, clientY);
  if (!hovered) return undefined;

  return buildSingleVariableHoverTitle(hovered.name, lookup);
};

export const createVariableTitleDecoration = (variableName: string, lookup: VariableLookup) => {
  const value = lookup[normalizeVariableKey(variableName)];
  if (value === undefined) return undefined;

  const resolved = resolveVariableText(value, lookup);
  return resolved.resolved ? resolved.text : undefined;
};

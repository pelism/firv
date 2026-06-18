export type VariableLookup = Record<string, string>;

const TEMPLATE_VARIABLE_REGEX = /\{\{\s*([a-zA-Z0-9_-]+)\s*}}/g;

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

export const buildVariableHoverTitle = (text: string, lookup: VariableLookup): string | undefined => {
  const names = extractTemplateVariableNames(text);
  if (names.length === 0) return undefined;

  const lines = names
    .map(name => {
      const value = lookup[normalizeVariableKey(name)];
      return value === undefined ? null : `${name}: ${value}`;
    })
    .filter((line): line is string => line !== null);

  return lines.length > 0 ? lines.join('\n') : undefined;
};

export const buildSingleVariableHoverTitle = (variableName: string, lookup: VariableLookup): string | undefined => {
  const value = lookup[normalizeVariableKey(variableName)];
  return value === undefined ? undefined : `${variableName}: ${value}`;
};

export const createVariableTitleDecoration = (variableName: string, lookup: VariableLookup) => {
  const value = lookup[normalizeVariableKey(variableName)];
  return value === undefined ? undefined : `${variableName}: ${value}`;
};

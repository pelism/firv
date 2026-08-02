import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { AlertTriangle, ChevronDown, KeyRound, RotateCcw, ArrowRightToLine } from 'lucide-react';
import type { BeforeRunStep } from '../types/beforeRunStep';
import type { RequestExtractionRule } from '../types/requestExtractionRule';
import type { RequestChainStep } from '../types/requestChainStep';
import type { RequestVariable } from '../types/requestVariable';
import type { KeyValue, SecretOption } from './editors/KVEditor';
import { resolveRequestDisplayName, resolveRequestIdByName, getRequestDisplayName, normalizeExtractionTarget, extractRequestVariableNamesFromSources, getUnresolvedRequestVariableNames, RequestOption } from './requestEditorUtils';
import { getVariableHoverTitleAtPoint, normalizeVariableKey, type VariableLookup } from '../lib/variableHover';
import { useSecretModalStore } from '../store/secretModalStore';

interface RequestEditorTransformsSectionProps {
  templateText: string;
  onTemplateTextChange: (value: string) => void;
  extractions: RequestExtractionRule[];
  onAddExtraction: () => void;
  onUpdateExtraction: (index: number, patch: Partial<RequestExtractionRule>) => void;
  onRemoveExtraction: (index: number) => void;
  beforeRunChain: BeforeRunStep[];
  onBeforeRunChainChange: Dispatch<SetStateAction<BeforeRunStep[]>>;
  chainSteps: RequestChainStep[];
  onChainStepsChange: Dispatch<SetStateAction<RequestChainStep[]>>;
  showChainPicker: boolean;
  onToggleChainPicker: () => void;
  onAddChainStep: (placement?: 'before' | 'on_success' | 'on_failure') => void;
  requestOptions: RequestOption[];
  getRequestName: (id: string) => string;
  workspaceGlobals: VariableLookup;
  url: string;
  headers: KeyValue[];
  params: KeyValue[];
  body: string;
  formBody: KeyValue[];
  authorization: string;
  requestVariables: RequestVariable[];
  beforeRunSuppliedVariableNames: string[];
  onUpdateRequestVariableDefault: (name: string, value: string) => void;
  onUpdateRequestVariableSecretRef: (name: string, secretId: string | undefined) => void;
  secretOptions: SecretOption[];
  onCreateSecret: (name: string, value: string) => Promise<string>;
  runOverrides: Record<string, string>;
  onUpdateRunOverride: (name: string, value: string) => void;
}

const NEW_SECRET_OPTION = '__new_secret__';

export function RequestEditorTransformsSection({
  templateText,
  onTemplateTextChange,
  extractions,
  onAddExtraction,
  onUpdateExtraction,
  onRemoveExtraction,
  beforeRunChain,
  onBeforeRunChainChange,
  chainSteps,
  onChainStepsChange,
  showChainPicker,
  onToggleChainPicker,
  onAddChainStep,
  requestOptions,
  getRequestName,
  workspaceGlobals,
  url,
  headers,
  params,
  body,
  formBody,
  authorization,
  requestVariables,
  beforeRunSuppliedVariableNames,
  onUpdateRequestVariableDefault,
  onUpdateRequestVariableSecretRef,
  secretOptions,
  onCreateSecret,
  runOverrides,
  onUpdateRunOverride,
}: RequestEditorTransformsSectionProps) {
  const variableSources = { url, headers, params, body, formBody, authorization };
  const detectedRequestVariableNames = extractRequestVariableNamesFromSources(variableSources).filter(
    name => workspaceGlobals[normalizeVariableKey(name)] === undefined
  );
  const unresolvedNameSet = new Set(
    getUnresolvedRequestVariableNames(variableSources, workspaceGlobals, requestVariables, runOverrides, beforeRunSuppliedVariableNames)
  );
  const beforeRunSuppliedNameSet = new Set(beforeRunSuppliedVariableNames.map(normalizeVariableKey));
  const [secretPickerName, setSecretPickerName] = useState<string | null>(null);
  const [templateHover, setTemplateHover] = useState<{ title: string; left: number } | null>(null);
  const secretPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!secretPickerName) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (secretPopoverRef.current && !secretPopoverRef.current.contains(e.target as Node)) {
        setSecretPickerName(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [secretPickerName]);

  const handleSecretSelect = async (name: string, selection: string) => {
    if (selection === '') {
      onUpdateRequestVariableSecretRef(name, undefined);
      setSecretPickerName(null);
      return;
    }

    if (selection === NEW_SECRET_OPTION) {
      const existingNames = secretOptions.map(o => o.name);
      const result = await useSecretModalStore.getState().openSecretModal({
        title: 'New Secret',
        description: 'Stored locally outside your workspace files, referenced by name across variables in this workspace.',
        initialName: name,
        existingNames,
      });
      if (!result) return;

      try {
        const id = await onCreateSecret(result.name, result.value);
        onUpdateRequestVariableSecretRef(name, id);
        setSecretPickerName(null);
      } catch (err) {
        console.error('Failed to create secret', err);
      }
      return;
    }

    onUpdateRequestVariableSecretRef(name, selection);
    setSecretPickerName(null);
  };

  const handleTemplateMouseMove = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const title = getVariableHoverTitleAtPoint(e.currentTarget.value, workspaceGlobals, e.currentTarget, e.clientX, e.clientY);
    if (!title) {
      setTemplateHover(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    setTemplateHover({ title, left: e.clientX - rect.left });
  };

  return (
    <div data-testid="request-editor-transforms-section" className="h-full flex flex-col gap-4">
      <div className="space-y-3" data-testid="request-variables-section">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Request Variables</label>
          <p className="text-xs text-muted-foreground">
            Detected from <code>{'{{name}}'}</code> placeholders in the URL, headers, params, or body that aren't already a workspace global or environment variable. Set a default here, or override it just for this run.
          </p>
        </div>

        {detectedRequestVariableNames.length === 0 ? (
          <div className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-4">
            No request-specific <code>{'{{name}}'}</code> placeholders found. Placeholders that match an existing global or environment variable are managed there instead.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="hidden md:grid grid-cols-[1fr_1fr_1fr_5.5rem] gap-3 px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Name</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Default</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Temporary (this run)</span>
              <span></span>
            </div>
            {detectedRequestVariableNames.map(name => {
              const requestVariable = requestVariables.find(rv => rv.key === name);
              const defaultValue = requestVariable?.value ?? '';
              const secretRef = requestVariable?.secret_ref ?? null;
              const overrideValue = runOverrides[name] ?? '';
              const hasOverride = overrideValue.trim() !== '';
              const isSuppliedByChain = beforeRunSuppliedNameSet.has(normalizeVariableKey(name));
              const isUnresolved = unresolvedNameSet.has(name);
              const isSecretPickerOpen = secretPickerName === name;

              return (
                <div key={name} className="rounded-xl border border-border p-3 bg-muted/20 grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_5.5rem] gap-3 items-center">
                  <div className="min-w-0">
                    <div className="text-sm font-mono font-semibold truncate" title={name}>{name}</div>
                    {isSuppliedByChain && (
                      <span
                        title="Supplied automatically by the before-run chain step's response extraction. This default is only used as a fallback if that extraction doesn't run or doesn't find a value."
                        className="inline-block mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary/80"
                      >
                        from chain
                      </span>
                    )}
                  </div>

                  {secretRef || isSecretPickerOpen ? (
                    <div className="relative" ref={isSecretPickerOpen ? secretPopoverRef : undefined}>
                      <button
                        type="button"
                        onClick={() => setSecretPickerName(prev => (prev === name ? null : name))}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                      >
                        <span className="truncate">{secretRef ? `🔒 ${secretOptions.find(o => o.id === secretRef)?.name ?? 'Unknown secret'}` : 'Choose a secret...'}</span>
                        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                      </button>
                      {isSecretPickerOpen && (
                        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[10rem] rounded-md border border-border bg-popover shadow-md overflow-hidden py-1">
                          {secretRef && (
                            <button
                              type="button"
                              onClick={() => handleSecretSelect(name, '')}
                              className="flex w-full items-center px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary"
                            >
                              Use plain text value instead
                            </button>
                          )}
                          {secretOptions.map(option => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => handleSecretSelect(name, option.id)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-mono transition-colors hover:bg-primary/15 hover:text-primary"
                            >
                              🔒 {option.name}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => handleSecretSelect(name, NEW_SECRET_OPTION)}
                            className="flex w-full items-center px-3 py-2 text-left text-xs font-bold text-primary transition-colors hover:bg-primary/15"
                          >
                            + New secret...
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <input
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
                      value={defaultValue}
                      onChange={e => onUpdateRequestVariableDefault(name, e.target.value)}
                      placeholder={isSuppliedByChain ? 'Fallback value (optional)' : 'Default value'}
                    />
                  )}

                  <input
                    className={`w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 ${hasOverride ? 'border-primary/50 ring-2 ring-primary/20' : 'border-border'}`}
                    value={overrideValue}
                    onChange={e => onUpdateRunOverride(name, e.target.value)}
                    placeholder="Temporary value"
                  />

                  <div className="flex items-center gap-1 justify-end">
                    {isUnresolved && (
                      <span title="No default or temporary value set — the literal {{name}} placeholder will be sent as-is.">
                        <AlertTriangle size={16} className="text-amber-500" />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onUpdateRunOverride(name, defaultValue)}
                      disabled={!defaultValue.trim()}
                      title="Copy default into temporary value"
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ArrowRightToLine size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateRunOverride(name, '')}
                      disabled={!hasOverride}
                      title="Reset temporary value"
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => (secretRef ? onUpdateRequestVariableSecretRef(name, undefined) : setSecretPickerName(prev => (prev === name ? null : name)))}
                      title={secretRef ? 'Backed by a secret (click to use a plain text value instead)' : 'Use a secret for the default value'}
                      className={`p-1.5 rounded transition-colors ${secretRef ? 'text-amber-500 hover:text-amber-600' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                    >
                      <KeyRound size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="relative">
        <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Pre-request Liquid Template</label>
        <textarea
          value={templateText}
          onChange={e => onTemplateTextChange(e.target.value)}
          placeholder="Build or rewrite the body before the request is sent."
          onMouseMove={handleTemplateMouseMove}
          onMouseLeave={() => setTemplateHover(null)}
          className="w-full min-h-35 rounded-xl border border-border bg-background p-3 text-sm font-mono outline-none resize-y"
        />
        {templateHover && (
          <div
            role="tooltip"
            className="pointer-events-none absolute left-0 top-full z-50 mt-2 rounded-md bg-neutral-900 px-2 py-1 text-xs text-white shadow-lg whitespace-pre-wrap"
            style={{ left: Math.max(8, templateHover.left) }}
          >
            {templateHover.title}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">Response Extractions</label>
        <button onClick={onAddExtraction} className="text-xs font-semibold text-primary hover:underline">Add extraction</button>
      </div>

      <datalist id="request-name-options">
        {requestOptions.map(option => (
          <option key={option.id} value={option.name} />
        ))}
      </datalist>

      <div className="space-y-3">
        {extractions.length === 0 && (
          <div className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-4">
            No extraction rules yet. Add one to capture values from the response body.
          </div>
        )}
        {extractions.map((rule, index) => (
          <div key={index} className="rounded-xl border border-border p-3 bg-muted/20 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={rule.target} onChange={e => onUpdateExtraction(index, { target: normalizeExtractionTarget(e.target.value) })} placeholder="token" />
              <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={rule.source} onChange={e => onUpdateExtraction(index, { source: e.target.value as any })}>
                <option value="response_body_json">response_body_json</option>
                <option value="response_body_raw">response_body_raw</option>
              </select>
              <button onClick={() => onRemoveExtraction(index)} className="rounded-lg border border-border px-3 py-2 text-sm text-destructive">Remove</button>
            </div>
            <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono" value={rule.pattern} onChange={e => onUpdateExtraction(index, { pattern: e.target.value })} placeholder="$.access_token or literal substring" />
          </div>
        ))}
      </div>

      <div className="pt-4 pb-4 border-t border-border space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">Request Chain</label>
          <button onClick={onToggleChainPicker} className="text-xs font-semibold text-primary hover:underline" title="Add chain step" type="button">
            Add chain step
          </button>
        </div>

        <div className="space-y-3">
          {beforeRunChain.length === 0 && chainSteps.length === 0 && (
            <div className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-4">
              No chain steps yet. Add one before, on success, or on failure.
            </div>
          )}

          {showChainPicker && (
            <div className="rounded-xl border border-border bg-background p-3 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Add chain step</span>
                <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onToggleChainPicker} type="button">
                  Cancel
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted transition-colors" onClick={() => onAddChainStep('before')}>
                  before
                </button>
                <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted transition-colors" onClick={() => onAddChainStep('on_success')}>
                  on success
                </button>
                <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted transition-colors" onClick={() => onAddChainStep('on_failure')}>
                  on failure
                </button>
              </div>
            </div>
          )}

          {beforeRunChain.length > 0 && (
            <div className="rounded-xl border border-border p-3 bg-muted/20 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">before</span>
                <span className="text-[10px] text-muted-foreground">1 of 1</span>
              </div>
              {beforeRunChain.map((step, index) => (
                <div key={`before-${index}`} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input
                      list="request-name-options"
                      className="md:col-span-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                      value={resolveRequestDisplayName(requestOptions, step.request_id)}
                      onChange={e => onBeforeRunChainChange(current => current.map((item, i) => i === index ? { ...item, request_id: resolveRequestIdByName(requestOptions, e.target.value) || e.target.value.trim() } : item))}
                      placeholder="Search request by name"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button onClick={() => onBeforeRunChainChange(() => [])} className="rounded-lg border border-border px-3 py-2 text-sm text-destructive">Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {chainSteps.filter(step => step.when === 'on_success').length > 0 && (
            <div className="rounded-xl border border-border p-3 bg-muted/20 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">success</span>
                <span className="text-[10px] text-muted-foreground">1 of 1</span>
              </div>
              {chainSteps.filter(step => step.when === 'on_success').map((step, index) => {
                const actualIndex = chainSteps.findIndex(item => item === step);
                return (
                  <div key={`success-${index}`} className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <input
                        list="request-name-options"
                        className="md:col-span-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                        value={resolveRequestDisplayName(requestOptions, step.next_request_id)}
                        onChange={e => onChainStepsChange(current => current.map((item, i) => i === actualIndex ? { ...item, next_request_id: resolveRequestIdByName(requestOptions, e.target.value) || e.target.value.trim() } : item))}
                        placeholder="Search request by name"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button onClick={() => onChainStepsChange(current => current.filter((_, i) => i !== actualIndex))} className="rounded-lg border border-border px-3 py-2 text-sm text-destructive">Remove</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {chainSteps.filter(step => step.when === 'on_failure').length > 0 && (
            <div className="rounded-xl border border-border p-3 bg-muted/20 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">failure</span>
                <span className="text-[10px] text-muted-foreground">1 of 1</span>
              </div>
              {chainSteps.filter(step => step.when === 'on_failure').map((step, index) => {
                const actualIndex = chainSteps.findIndex(item => item === step);
                return (
                  <div key={`failure-${index}`} className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <input
                        list="request-name-options"
                        className="md:col-span-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                        value={getRequestDisplayName(requestOptions, getRequestName, step.next_request_id)}
                        onChange={e => onChainStepsChange(current => current.map((item, i) => i === actualIndex ? { ...item, next_request_id: resolveRequestIdByName(requestOptions, e.target.value) } : item))}
                        placeholder="Search request by name"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button onClick={() => onChainStepsChange(current => current.filter((_, i) => i !== actualIndex))} className="rounded-lg border border-border px-3 py-2 text-sm text-destructive">Remove</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

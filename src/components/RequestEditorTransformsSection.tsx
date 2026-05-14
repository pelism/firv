import type { Dispatch, SetStateAction } from 'react';
import type { BeforeRunStep } from '../types/beforeRunStep';
import type { RequestExtractionRule } from '../types/requestExtractionRule';
import type { RequestChainStep } from '../types/requestChainStep';
import { resolveRequestDisplayName, resolveRequestIdByName, getRequestDisplayName, RequestOption } from './requestEditorUtils';

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
}

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
}: RequestEditorTransformsSectionProps) {
  return (
    <div className="h-full flex flex-col gap-4">
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Pre-request Liquid Template</label>
        <textarea
          value={templateText}
          onChange={e => onTemplateTextChange(e.target.value)}
          placeholder="Build or rewrite the body before the request is sent."
          className="w-full min-h-35 rounded-xl border border-border bg-background p-3 text-sm font-mono outline-none resize-y"
        />
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
              <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={rule.target} onChange={e => onUpdateExtraction(index, { target: e.target.value })} placeholder="target variable" />
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

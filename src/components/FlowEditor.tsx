import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { twMerge } from 'tailwind-merge';
import { Plus, Trash2, ChevronUp, ChevronDown, Play, Save, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useSidebarStore } from '../store/sidebarStore';
import { flattenRequestOptions, normalizeExtractionTarget } from './requestEditorUtils';
import { KVEditor, type KeyValue } from './editors/KVEditor';
import type { KeyValue as PersistedKeyValue } from '../types/keyValue';
import type { FirvFlow } from '../types/firvFlow';
import type { FlowStep } from '../types/flowStep';
import type { FlowInputVariable } from '../types/flowInputVariable';
import type { FlowExtractionRule } from '../types/flowExtractionRule';
import type { ExtractionSource } from '../types/extractionSource';

interface FlowEditorProps {
  requestId: string;
}

interface FlowExportRuleUI {
  localId: string;
  target: string;
  source: ExtractionSource;
  pattern: string;
  enabled: boolean;
}

interface FlowStepUI {
  localId: string;
  request_id: string;
  input_variables: KeyValue[];
  export_variables: FlowExportRuleUI[];
  query_param_overrides: KeyValue[];
  skip_before_chain: boolean;
  skip_on_success_chain: boolean;
  skip_on_failure_chain: boolean;
}

interface FlowStepResult {
  request_id: string;
  success: boolean;
  status: number | null;
  execution_time_ms: number;
  error: string | null;
}

interface FlowResult {
  steps: FlowStepResult[];
  stopped_early: boolean;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

const inputVariablesToKeyValues = (inputs: FlowInputVariable[] | undefined): KeyValue[] =>
  (inputs || []).map(iv => ({ id: generateId(), key: iv.key, value: iv.value, enabled: iv.enabled, secretRef: undefined }));

const keyValuesToInputVariables = (kvs: KeyValue[]): FlowInputVariable[] => {
  const result: FlowInputVariable[] = [];
  for (const kv of kvs) {
    if (kv.enabled && kv.key.trim() !== '') {
      result.push({ key: kv.key.trim(), value: kv.value, enabled: kv.enabled });
    }
  }
  return result;
};

const queryParamOverridesToKeyValues = (overrides: PersistedKeyValue[] | undefined): KeyValue[] =>
  (overrides || []).map(o => ({
    id: generateId(),
    key: o.key,
    value: o.value,
    enabled: o.enabled,
    secretRef: o.secret_ref ?? undefined,
  }));

const keyValuesToQueryParamOverrides = (kvs: KeyValue[]): PersistedKeyValue[] => {
  const result: PersistedKeyValue[] = [];
  for (const kv of kvs) {
    if (kv.key.trim() === '') {
      continue;
    }
    result.push({
      key: kv.key.trim(),
      value: kv.value,
      enabled: kv.enabled,
      secret_ref: kv.secretRef ?? null,
    });
  }
  return result;
};

const exportVariablesToUI = (exports: FlowExtractionRule[] | undefined): FlowExportRuleUI[] =>
  (exports || []).map(ev => ({ localId: generateId(), target: ev.target, source: ev.source, pattern: ev.pattern, enabled: ev.enabled }));

const uiToExportVariables = (exports: FlowExportRuleUI[]): FlowExtractionRule[] =>
  exports.map(ev => ({ target: normalizeExtractionTarget(ev.target), source: ev.source, pattern: ev.pattern, enabled: ev.enabled }));

const stepToUI = (step: FlowStep): FlowStepUI => ({
  localId: generateId(),
  request_id: step.request_id,
  input_variables: inputVariablesToKeyValues(step.input_variables),
  export_variables: exportVariablesToUI(step.export_variables),
  query_param_overrides: queryParamOverridesToKeyValues(step.query_param_overrides),
  skip_before_chain: step.skip_before_chain,
  skip_on_success_chain: step.skip_on_success_chain,
  skip_on_failure_chain: step.skip_on_failure_chain,
});

const uiToStep = (step: FlowStepUI): FlowStep => ({
  request_id: step.request_id,
  input_variables: keyValuesToInputVariables(step.input_variables),
  export_variables: uiToExportVariables(step.export_variables),
  query_param_overrides: keyValuesToQueryParamOverrides(step.query_param_overrides),
  skip_before_chain: step.skip_before_chain,
  skip_on_success_chain: step.skip_on_success_chain,
  skip_on_failure_chain: step.skip_on_failure_chain,
});

export function FlowEditor({ requestId }: FlowEditorProps) {
  const [name, setName] = useState('New Flow');
  const [steps, setSteps] = useState<FlowStepUI[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [flowResult, setFlowResult] = useState<FlowResult | null>(null);
  const hasHydratedRef = useRef(false);
  const isHydratingRef = useRef(false);

  const { setDirty, dirtyRequests } = useAppStore();
  const isDirty = dirtyRequests.has(requestId);
  const { workspacePath, getRequestName, pendingNames, syncTreeToBackend, setRequestName } = useSidebarStore();
  const workspaceGlobals = useSidebarStore(state => state.workspaceGlobals);
  const sidebarTree = useSidebarStore(state => state.tree);

  const requestOptions = useMemo(() => flattenRequestOptions(sidebarTree), [sidebarTree]);

  useEffect(() => {
    async function loadFlow() {
      if (!workspacePath) return;
      isHydratingRef.current = true;
      try {
        const flow: FirvFlow = await invoke('get_flow', { workspaceRoot: workspacePath, id: requestId });
        setName(flow.name || 'New Flow');
        setSteps((flow.steps || []).map(stepToUI));
      } catch {
        // Flow doesn't exist on disk yet (newly created, unsaved) - keep defaults.
      } finally {
        isHydratingRef.current = false;
        hasHydratedRef.current = true;
      }
    }
    if (!hasHydratedRef.current) {
      void loadFlow();
    }
  }, [workspacePath, requestId]);

  const markDirty = () => {
    if (!isHydratingRef.current) setDirty(requestId, true);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    setRequestName(requestId, value);
    markDirty();
  };

  const addStep = () => {
    setSteps(current => [...current, {
      localId: generateId(),
      request_id: requestOptions[0]?.id || '',
      input_variables: [],
      export_variables: [],
      query_param_overrides: [],
      skip_before_chain: false,
      skip_on_success_chain: false,
      skip_on_failure_chain: false,
    }]);
    markDirty();
  };

  const updateStep = (localId: string, updates: Partial<FlowStepUI>) => {
    setSteps(current => current.map(step => step.localId === localId ? { ...step, ...updates } : step));
    markDirty();
  };

  const removeStep = (localId: string) => {
    setSteps(current => current.filter(step => step.localId !== localId));
    markDirty();
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    setSteps(current => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    markDirty();
  };

  const saveFlow = async () => {
    if (!workspacePath) return;
    const pendingName = pendingNames[requestId];
    const flowName = pendingName || name;
    if (pendingName) {
      setName(pendingName);
    }
    setRequestName(requestId, flowName);

    const flow: FirvFlow = {
      id: requestId,
      name: flowName,
      steps: steps.map(uiToStep),
    };

    try {
      await invoke('update_flow', { workspaceRoot: workspacePath, flow });

      setDirty(requestId, false);
      await syncTreeToBackend(useSidebarStore.getState().tree);
    } catch (e) {
      console.error('Failed to save flow', e);
    }
  };

  const runFlow = async () => {
    if (!workspacePath) return;
    setIsRunning(true);
    setFlowResult(null);
    try {
      const flow: FirvFlow = {
        id: requestId,
        name,
        steps: steps.map(uiToStep),
      };
      const result: FlowResult = await invoke('run_firv_flow', { workspaceRoot: workspacePath, flow });
      setFlowResult(result);
    } catch (e: any) {
      setFlowResult({ steps: [], stopped_early: true });
      console.error('Failed to run flow', e);
    } finally {
      setIsRunning(false);
    }
  };

  const getStepResult = (index: number): FlowStepResult | undefined => flowResult?.steps[index];

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-background w-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-500/15 text-indigo-500 uppercase tracking-wider">
          Flow
        </span>
        <input
          type="text"
          value={name}
          onChange={e => handleNameChange(e.target.value)}
          className="flex-1 bg-transparent text-sm font-semibold outline-none border-none text-foreground"
          placeholder="Flow name"
        />
        <button
          onClick={saveFlow}
          disabled={!workspacePath}
          className={twMerge(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
            isDirty ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground"
          )}
          title="Save Flow"
        >
          <Save size={14} />
          Save
        </button>
        <button
          onClick={runFlow}
          disabled={isRunning || steps.length === 0 || !workspacePath}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 transition-all"
          title="Run Flow"
        >
          <Play size={14} />
          {isRunning ? 'Running...' : 'Run'}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 custom-scrollbar">
        <div className="max-w-4xl mx-auto flex flex-col gap-3">
          {steps.length === 0 && (
            <div className="text-sm text-muted-foreground italic py-8 text-center border border-dashed border-border rounded-xl">
              No steps yet. Add requests to run them in order.
            </div>
          )}

          {steps.map((step, index) => {
            const result = getStepResult(index);
            return (
              <div key={step.localId} className="border border-border rounded-xl bg-card p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold text-muted-foreground w-5 text-center">{index + 1}</span>
                  <select
                    value={step.request_id}
                    onChange={e => updateStep(step.localId, { request_id: e.target.value })}
                    className="flex-1 h-8 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="" disabled>Select a request...</option>
                    {requestOptions.map(opt => (
                      <option key={opt.id} value={opt.id}>{getRequestName(opt.id) || opt.name}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => moveStep(index, -1)}
                      disabled={index === 0}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
                      title="Move up"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      onClick={() => moveStep(index, 1)}
                      disabled={index === steps.length - 1}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
                      title="Move down"
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      onClick={() => removeStep(step.localId)}
                      className="p-1.5 rounded text-gray-500 hover:text-red-500 hover:bg-muted"
                      title="Remove step"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {result && (
                    result.success
                      ? <CheckCircle2 size={16} className="text-emerald-500" />
                      : <XCircle size={16} className="text-red-500" />
                  )}
                </div>

                <div className="flex items-center gap-4 mb-2 pl-7">
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={step.skip_before_chain}
                      onChange={e => updateStep(step.localId, { skip_before_chain: e.target.checked })}
                    />
                    Skip 'before' chain
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={step.skip_on_success_chain}
                      onChange={e => updateStep(step.localId, { skip_on_success_chain: e.target.checked })}
                    />
                    Skip 'on success' chain
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={step.skip_on_failure_chain}
                      onChange={e => updateStep(step.localId, { skip_on_failure_chain: e.target.checked })}
                    />
                    Skip 'on failure' chain
                  </label>
                </div>

                <div className="pl-7 space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Query param overrides</label>
                    <KVEditor
                      data={step.query_param_overrides}
                      onChange={kvs => updateStep(step.localId, { query_param_overrides: kvs })}
                      placeholderKey="param name"
                      placeholderValue="value or {{var}}"
                      variableLookup={workspaceGlobals}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Input variables</label>
                    <KVEditor
                      data={step.input_variables}
                      onChange={kvs => updateStep(step.localId, { input_variables: kvs })}
                      placeholderKey="local name"
                      placeholderValue="value or {{var}}"
                      variableLookup={workspaceGlobals}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Export variables</label>
                      <button
                        type="button"
                        onClick={() => updateStep(step.localId, { export_variables: [...step.export_variables, { localId: generateId(), target: '', source: 'response_body_json', pattern: '', enabled: true }] })}
                        className="text-[10px] font-semibold text-primary hover:underline"
                      >
                        + Add export
                      </button>
                    </div>
                    {step.export_variables.length === 0 ? (
                      <div className="text-xs text-muted-foreground border border-dashed border-border rounded-xl p-3">
                        No export variables. Add one to pass values to the next step.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {step.export_variables.map(ev => (
                          <div key={ev.localId} className="rounded-xl border border-border p-3 bg-muted/20 space-y-2">
                            <div className="grid grid-cols-1 md:grid-cols-[2.5rem_1fr_1fr_auto] gap-2 items-center">
                              <label className="flex items-center justify-center">
                                <input
                                  type="checkbox"
                                  checked={ev.enabled}
                                  onChange={e => updateStep(step.localId, { export_variables: step.export_variables.map(item => item.localId === ev.localId ? { ...item, enabled: e.target.checked } : item) })}
                                  title="Enable export"
                                />
                              </label>
                              <input
                                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                                value={ev.target}
                                onChange={e => updateStep(step.localId, { export_variables: step.export_variables.map(item => item.localId === ev.localId ? { ...item, target: e.target.value } : item) })}
                                placeholder="token"
                              />
                              <select
                                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                                value={ev.source}
                                onChange={e => updateStep(step.localId, { export_variables: step.export_variables.map(item => item.localId === ev.localId ? { ...item, source: e.target.value as ExtractionSource } : item) })}
                              >
                                <option value="response_body_json">response_body_json</option>
                                <option value="response_body_raw">response_body_raw</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => updateStep(step.localId, { export_variables: step.export_variables.filter(item => item.localId !== ev.localId) })}
                                className="p-1.5 rounded text-muted-foreground hover:text-red-500 hover:bg-muted"
                                title="Remove export"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                            <input
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                              value={ev.pattern}
                              onChange={e => updateStep(step.localId, { export_variables: step.export_variables.map(item => item.localId === ev.localId ? { ...item, pattern: e.target.value } : item) })}
                              placeholder="$.access_token or literal substring"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {result && (
                  <div className={twMerge(
                    "mt-2 pl-7 text-[11px] flex items-center gap-2",
                    result.success ? "text-emerald-600" : "text-red-500"
                  )}>
                    {result.status !== null ? `Status ${result.status}` : 'No response'} · {result.execution_time_ms}ms
                    {result.error && <span className="opacity-80">· {result.error}</span>}
                  </div>
                )}
              </div>
            );
          })}

          <button
            onClick={addStep}
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-border text-sm font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all"
          >
            <Plus size={16} />
            Add Step
          </button>

          {flowResult?.stopped_early && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-600 text-xs font-semibold">
              <AlertTriangle size={14} />
              Flow stopped early — a step failed or its request could not be resolved.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { CircleSlash2 } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { KVEditor, KeyValue } from './editors/KVEditor';
import { BodyEditor } from './editors/BodyEditor';
import type { RequestAuthorizationState } from './requestEditorUtils';
import { getVariableHoverTitleAtPoint, type VariableLookup } from '../lib/variableHover';

interface RequestEditorBodySectionProps {
  activeTab: 'params' | 'headers' | 'body' | 'transforms';
  headers: KeyValue[];
  authorization: RequestAuthorizationState;
  params: KeyValue[];
  body: string;
  bodyMode: 'none' | 'form' | 'json' | 'raw';
  jsonViewMode: 'Raw' | 'Preview';
  onBodyModeChange: (mode: 'none' | 'form' | 'json' | 'raw') => void;
  onJsonViewModeChange: (mode: 'Raw' | 'Preview') => void;
  onBodyChange: (value: string) => void;
  onHeadersChange: (value: KeyValue[]) => void;
  onAuthorizationChange: (value: RequestAuthorizationState) => void;
  onParamsChange: (value: KeyValue[]) => void;
  formBody: KeyValue[];
  onAddFormField: () => void;
  onRemoveFormField: (index: number) => void;
  onUpdateFormField: (index: number, patch: Partial<KeyValue>) => void;
  bodyErrorLine: number | null;
  workspaceGlobals: VariableLookup;
}

export function RequestEditorBodySection({
  activeTab,
  headers,
  authorization,
  params,
  body,
  bodyMode,
  jsonViewMode,
  onBodyModeChange,
  onJsonViewModeChange,
  onBodyChange,
  onHeadersChange,
  onAuthorizationChange,
  onParamsChange,
  formBody,
  onAddFormField,
  onRemoveFormField,
  onUpdateFormField,
  bodyErrorLine,
  workspaceGlobals,
}: RequestEditorBodySectionProps) {
  const [authHover, setAuthHover] = useState<{ title: string; left: number } | null>(null);
  const [templateHover, setTemplateHover] = useState<{ title: string; left: number } | null>(null);

  const handleAuthMouseMove = (e: React.MouseEvent<HTMLInputElement>) => {
    const title = getVariableHoverTitleAtPoint(authorization.value, workspaceGlobals, e.currentTarget, e.clientX, e.clientY);
    if (!title) {
      setAuthHover(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    setAuthHover({ title, left: e.clientX - rect.left });
  };

  const handleTemplateMouseMove = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const title = getVariableHoverTitleAtPoint((e.currentTarget as HTMLTextAreaElement).value, workspaceGlobals, e.currentTarget, e.clientX, e.clientY);
    if (!title) {
      setTemplateHover(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    setTemplateHover({ title, left: e.clientX - rect.left });
  };

  return (
    <div className="flex-1 overflow-auto p-4 custom-scrollbar">
      <div className="max-w-5xl h-full flex flex-col">
        {activeTab === 'headers' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Authorization</div>
                  <div className="text-xs text-muted-foreground mt-1">Configure a bearer token or keep authorization disabled.</div>
                </div>
                <select
                  value={authorization.mode}
                  onChange={e => onAuthorizationChange({ ...authorization, mode: e.target.value as 'none' | 'bearer' })}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="none">none</option>
                  <option value="bearer">Bearer</option>
                </select>
              </div>

              {authorization.mode === 'bearer' && (
                <div className="relative grid grid-cols-1 gap-3 items-center">
                  <input
                    value={authorization.value}
                    onChange={e => onAuthorizationChange({ ...authorization, value: e.target.value })}
                    placeholder="Bearer token or {{token}}"
                    onMouseMove={handleAuthMouseMove}
                    onMouseLeave={() => setAuthHover(null)}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                  />
                  {authHover && (
                    <div role="tooltip" className="pointer-events-none absolute left-0 top-full z-50 mt-2 rounded-md bg-neutral-900 px-2 py-1 text-xs text-white shadow-lg whitespace-pre-wrap" style={{ left: Math.max(8, authHover.left) }}>
                      {authHover.title}
                    </div>
                  )}
                </div>
              )}
            </div>

            <KVEditor data={headers} onChange={onHeadersChange} placeholderKey="Header Name" placeholderValue="Value" variableLookup={workspaceGlobals} />
          </div>
        )}
        {activeTab === 'params' && (
          <KVEditor data={params} onChange={onParamsChange} placeholderKey="Query Param" placeholderValue="Value" variableLookup={workspaceGlobals} />
        )}
        {activeTab === 'body' && (
          <div className="h-full flex flex-col">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex gap-2 bg-muted p-1 rounded-lg ring-1 ring-border">
                {['none', 'form', 'json', 'raw'].map(mode => (
                  <button
                    key={mode}
                    onClick={() => onBodyModeChange(mode as any)}
                    className={twMerge(
                      'px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all',
                      bodyMode === mode
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {bodyMode === 'none' ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm space-y-2 bg-muted/50">
                  <div className="p-3 rounded-full bg-muted">
                    <CircleSlash2 size={24} className="opacity-50" />
                  </div>
                  <p className="font-medium">No Request Body</p>
                  <p className="text-xs">Select a mode above to add a body.</p>
                </div>
              ) : bodyMode === 'form' ? (
                <div className="h-full min-h-0 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Form Fields</span>
                    <button type="button" onClick={onAddFormField} className="text-xs font-semibold text-primary hover:underline">
                      Add field
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-2 custom-scrollbar">
                    {formBody.length === 0 && (
                      <div className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-4 bg-muted/20">
                        No form fields yet. Add one to build a URL-encoded form body.
                      </div>
                    )}
                    {formBody.map((field, index) => (
                      <div key={field.id ?? index} className="rounded-xl border border-border p-3 bg-muted/20 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">field {index + 1}</span>
                          <span className="text-[10px] text-muted-foreground">{field.enabled ?? true ? 'enabled' : 'disabled'}</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                          <input className="md:col-span-4 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={field.key} onChange={e => onUpdateFormField(index, { key: e.target.value })} placeholder="Key" />
                          <input className="md:col-span-6 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={field.value} onChange={e => onUpdateFormField(index, { value: e.target.value })} placeholder="Value" />
                          <div className="md:col-span-1 flex items-center justify-center rounded-lg border border-border bg-background">
                            <input type="checkbox" checked={field.enabled ?? true} onChange={e => onUpdateFormField(index, { enabled: e.target.checked })} />
                          </div>
                          <button type="button" onClick={() => onRemoveFormField(index)} className="md:col-span-1 rounded-lg border border-border px-3 py-2 text-sm text-destructive bg-background hover:bg-muted transition-colors">
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-full min-h-0 flex flex-col gap-4">
                  {bodyMode === 'json' && (
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">JSON Body</div>
                      <select
                        value={jsonViewMode}
                        aria-label="JSON view mode"
                        onChange={e => onJsonViewModeChange(e.target.value as 'Raw' | 'Preview')}
                        className="text-[11px] font-bold uppercase tracking-wider bg-background border border-border rounded-lg px-3 py-1 outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
                      >
                        <option value="Raw">Raw</option>
                        <option value="Preview">Preview</option>
                      </select>
                    </div>
                  )}
                  {bodyMode === 'json' && jsonViewMode === 'Preview' ? (
                    <div className="flex-1 min-h-0 border border-border rounded-xl overflow-hidden shadow-sm">
                      <div className="h-full overflow-auto p-4 bg-background">
                        <pre className="text-xs font-mono whitespace-pre-wrap text-foreground">{body.trim() ? JSON.stringify(JSON.parse(body), null, 2) : '(empty JSON body)'}</pre>
                      </div>
                    </div>
                  ) : (
                    <BodyEditor value={body} mode={bodyMode} onChange={onBodyChange} highlightLine={bodyErrorLine} workspaceGlobals={workspaceGlobals} />
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

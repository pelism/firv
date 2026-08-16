import React, { useMemo, useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { listOperations, OpenApiDoc, OpenApiOperationSummary } from '../lib/openapi';
import { twMerge } from 'tailwind-merge';

interface OpenApiImportModalProps {
  isOpen: boolean;
  doc: OpenApiDoc | null;
  onClose: () => void;
  onImport: (selected: OpenApiOperationSummary[]) => void;
}

const methodBadgeStyles: Record<string, string> = {
  get: 'text-blue-600 bg-blue-500/10',
  post: 'text-emerald-600 bg-emerald-500/10',
  put: 'text-amber-600 bg-amber-500/10',
  delete: 'text-red-600 bg-red-500/10',
  patch: 'text-purple-600 bg-purple-500/10',
  head: 'text-muted-foreground bg-muted',
  options: 'text-muted-foreground bg-muted',
};

export const OpenApiImportModal: React.FC<OpenApiImportModalProps> = ({ isOpen, doc, onClose, onImport }) => {
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const operations = useMemo(() => (doc ? listOperations(doc) : []), [doc]);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedKeys(new Set());
    }
  }, [isOpen, doc]);

  const filteredOperations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return operations;
    return operations.filter(op =>
      op.path.toLowerCase().includes(query) ||
      op.method.toLowerCase().includes(query) ||
      (op.summary || '').toLowerCase().includes(query) ||
      (op.operationId || '').toLowerCase().includes(query) ||
      op.tags.some(tag => tag.toLowerCase().includes(query))
    );
  }, [operations, search]);

  const groups = useMemo(() => {
    const map = new Map<string, OpenApiOperationSummary[]>();
    for (const op of filteredOperations) {
      const tags = op.tags.length > 0 ? op.tags : ['Untagged'];
      for (const tag of tags) {
        if (!map.has(tag)) map.set(tag, []);
        map.get(tag)!.push(op);
      }
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredOperations]);

  const toggleOperation = (key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (groupOps: OpenApiOperationSummary[]) => {
    const allSelected = groupOps.every(op => selectedKeys.has(op.key));
    setSelectedKeys(prev => {
      const next = new Set(prev);
      for (const op of groupOps) {
        if (allSelected) next.delete(op.key);
        else next.add(op.key);
      }
      return next;
    });
  };

  const handleImport = () => {
    const selected = operations.filter(op => selectedKeys.has(op.key));
    onImport(selected);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import from OpenAPI</DialogTitle>
          <DialogDescription>Select the operations you want to create as requests.</DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="Search by path, method, summary, or tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="flex-1 overflow-y-auto min-h-0 border border-border rounded-lg divide-y divide-border">
          {groups.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground text-center">No operations found.</div>
          )}
          {groups.map(([tag, groupOps]) => {
            const allSelected = groupOps.every(op => selectedKeys.has(op.key));
            const someSelected = groupOps.some(op => selectedKeys.has(op.key));
            return (
              <div key={tag}>
                <label className="flex items-center gap-2 px-3 py-2 bg-muted/50 text-xs font-bold uppercase tracking-wider text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={() => toggleGroup(groupOps)}
                    className="accent-primary"
                  />
                  {tag}
                  <span className="ml-auto font-normal normal-case">{groupOps.length}</span>
                </label>
                {groupOps.map(op => (
                  <label
                    key={op.key}
                    className="flex items-center gap-2.5 px-3 py-2 pl-8 text-sm cursor-pointer hover:bg-muted/40 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(op.key)}
                      onChange={() => toggleOperation(op.key)}
                      className="accent-primary"
                    />
                    <span
                      className={twMerge(
                        'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase w-14 text-center shrink-0',
                        methodBadgeStyles[op.method] ?? 'text-muted-foreground bg-muted'
                      )}
                    >
                      {op.method}
                    </span>
                    <span className="truncate font-mono text-xs text-foreground" title={op.path}>{op.path}</span>
                    {op.summary && (
                      <span className="truncate text-xs text-muted-foreground ml-1" title={op.summary}>{op.summary}</span>
                    )}
                  </label>
                ))}
              </div>
            );
          })}
        </div>

        <DialogFooter className="pt-2 items-center sm:justify-between">
          <span className="text-xs text-muted-foreground sm:mr-auto">{selectedKeys.size} selected</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={selectedKeys.size === 0} onClick={handleImport}>
              Import {selectedKeys.size > 0 ? `(${selectedKeys.size})` : ''}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

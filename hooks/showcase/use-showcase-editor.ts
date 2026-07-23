"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ShowcaseDocument } from "@/lib/showcase/types";

type EditorSnapshot = {
  document: ShowcaseDocument | null;
  selectedId: string;
};

type CommitOptions = {
  record?: boolean;
  coalesceKey?: string;
  selectedId?: string;
};

const HISTORY_LIMIT = 40;
const COALESCE_MS = 750;

export function useShowcaseEditor() {
  const [editor, setEditor] = useState<EditorSnapshot>({ document: null, selectedId: "" });
  const historyRef = useRef<EditorSnapshot[]>([]);
  const futureRef = useRef<EditorSnapshot[]>([]);
  const coalesceRef = useRef({ key: "", at: 0 });
  const [historyVersion, setHistoryVersion] = useState(0);

  const reset = useCallback((document: ShowcaseDocument, selectedId?: string) => {
    historyRef.current = [];
    futureRef.current = [];
    coalesceRef.current = { key: "", at: 0 };
    setEditor({ document, selectedId: selectedId || document.scenes[0]?.id || "" });
    setHistoryVersion((value) => value + 1);
  }, []);

  const commit = useCallback((document: ShowcaseDocument, options: CommitOptions = {}) => {
    setEditor((current) => {
      if (!current.document) {
        return { document, selectedId: options.selectedId || document.scenes[0]?.id || "" };
      }
      const shouldRecord = options.record !== false;
      if (shouldRecord) {
        const now = Date.now();
        const key = options.coalesceKey || "";
        const isSameBurst = Boolean(key) && coalesceRef.current.key === key && now - coalesceRef.current.at < COALESCE_MS;
        if (!isSameBurst) {
          historyRef.current = [...historyRef.current.slice(-(HISTORY_LIMIT - 1)), current];
          futureRef.current = [];
          setHistoryVersion((value) => value + 1);
        }
        coalesceRef.current = { key, at: now };
      }
      const desiredId = options.selectedId ?? current.selectedId;
      const selectedId = document.scenes.some((scene) => scene.id === desiredId)
        ? desiredId
        : document.scenes[0]?.id || "";
      return { document, selectedId };
    });
  }, []);

  const select = useCallback((selectedId: string) => {
    setEditor((current) => ({ ...current, selectedId }));
  }, []);

  const clear = useCallback(() => {
    historyRef.current = [];
    futureRef.current = [];
    setEditor({ document: null, selectedId: "" });
    setHistoryVersion((value) => value + 1);
  }, []);

  const undo = useCallback(() => {
    setEditor((current) => {
      const previous = historyRef.current.pop();
      if (!previous || !current.document) return current;
      futureRef.current = [current, ...futureRef.current].slice(0, HISTORY_LIMIT);
      coalesceRef.current = { key: "", at: 0 };
      setHistoryVersion((value) => value + 1);
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setEditor((current) => {
      const next = futureRef.current.shift();
      if (!next || !current.document) return current;
      historyRef.current = [...historyRef.current, current].slice(-HISTORY_LIMIT);
      coalesceRef.current = { key: "", at: 0 };
      setHistoryVersion((value) => value + 1);
      return next;
    });
  }, []);

  return useMemo(() => ({
    document: editor.document,
    selectedId: editor.selectedId,
    reset,
    clear,
    commit,
    select,
    undo,
    redo,
    canUndo: historyRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    historyVersion,
  }), [clear, commit, editor.document, editor.selectedId, historyVersion, redo, reset, select, undo]);
}

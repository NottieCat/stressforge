"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getStress, submitStress } from "./api";
import type { StressRequest, StressResult } from "./types";

export type Phase = "idle" | "submitting" | "running" | "done" | "error";

interface RunState {
  phase: Phase;
  result: StressResult | null;
  error: string | null;
}

const POLL_MS = 650;

/**
 * Drives one stress run: submit -> poll until done. Cleans up its interval and
 * aborts in-flight fetches on unmount or when a new run starts. All API errors
 * are surfaced through `error` rather than thrown, so the UI stays graceful.
 */
export function useStressRun() {
  const [state, setState] = useState<RunState>({
    phase: "idle",
    result: null,
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeId = useRef<string | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    activeId.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const poll = useCallback((id: string) => {
    const tick = async () => {
      if (activeId.current !== id) return;
      try {
        const controller = new AbortController();
        abortRef.current = controller;
        const result = await getStress(id, controller.signal);
        if (activeId.current !== id) return;

        if (result.status === "done") {
          setState({ phase: "done", result, error: null });
          activeId.current = null;
          return;
        }
        setState({ phase: "running", result, error: null });
        timerRef.current = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (activeId.current !== id) return; // superseded/aborted
        if (e instanceof DOMException && e.name === "AbortError") return;
        const msg = e instanceof ApiError ? e.message : "Unexpected error";
        setState((s) => ({ ...s, phase: "error", error: msg }));
        activeId.current = null;
      }
    };
    tick();
  }, []);

  const run = useCallback(
    async (body: StressRequest) => {
      stop();
      setState({ phase: "submitting", result: null, error: null });
      try {
        const controller = new AbortController();
        abortRef.current = controller;
        const { id } = await submitStress(body, controller.signal);
        activeId.current = id;
        setState({
          phase: "running",
          result: { id, status: "queued", mode: "stress" },
          error: null,
        });
        poll(id);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Unexpected error";
        setState({ phase: "error", result: null, error: msg });
      }
    },
    [poll, stop],
  );

  const reset = useCallback(() => {
    stop();
    setState({ phase: "idle", result: null, error: null });
  }, [stop]);

  return { ...state, run, reset, cancel: stop };
}

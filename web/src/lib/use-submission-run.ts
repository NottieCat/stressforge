"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getSubmission, submitSubmission } from "./api";
import type { SubmissionRequest, SubmissionResult } from "./types";
import type { Phase } from "./use-stress-run";

interface RunState {
  phase: Phase;
  result: SubmissionResult | null;
  error: string | null;
}

const POLL_MS = 650;

/**
 * Drives one submission run: submit -> poll until done. Same lifecycle contract
 * as useStressRun (aborts in-flight fetches on unmount / new run, surfaces all
 * API errors through `error`), but against the /submissions endpoint.
 */
export function useSubmissionRun() {
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
        const result = await getSubmission(id, controller.signal);
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
    async (body: SubmissionRequest) => {
      stop();
      setState({ phase: "submitting", result: null, error: null });
      try {
        const controller = new AbortController();
        abortRef.current = controller;
        const { id } = await submitSubmission(body, controller.signal);
        activeId.current = id;
        setState({
          phase: "running",
          result: { id, status: "queued", mode: "submission" },
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

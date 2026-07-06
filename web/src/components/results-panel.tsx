"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { StressResult } from "@/lib/types";
import type { Phase } from "@/lib/use-stress-run";
import { verdictMeta } from "@/lib/verdict";
import { DiffView } from "./diff-view";

interface ResultsPanelProps {
  result: StressResult | null;
  phase: Phase;
  error: string | null;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-[oklch(0.155_0.012_200)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/** Progress strip: one cell per completed iteration (green ok / grey skipped). */
function IterationStrip({ result }: { result: StressResult }) {
  const per = result.perIter ?? [];
  const total = result.iterations ?? per.length;
  if (total === 0) return null;
  // Cap rendered cells for very large runs to keep the DOM light.
  const cells = per.slice(0, 400);
  return (
    <div className="flex flex-wrap gap-1">
      {cells.map((p) => (
        <div
          key={p.i}
          title={`#${p.i} · seed ${p.seed} · ${p.timeMs}ms · ${p.status}`}
          className={`h-2.5 w-2.5 rounded-[2px] ${
            p.status === "ok"
              ? "bg-[oklch(0.82_0.19_155_/_0.75)]"
              : "bg-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

export function ResultsPanel({ result, phase, error }: ResultsPanelProps) {
  const meta = verdictMeta(result?.verdict);
  const done = phase === "done" && result;

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Verdict banner */}
      <AnimatePresence mode="wait">
        {error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-md border border-[oklch(0.66_0.23_20_/_0.5)] bg-[oklch(0.66_0.23_20_/_0.1)] px-4 py-3 text-sm text-[var(--sf-red)]"
          >
            <span className="font-bold">connection error · </span>
            {error}
          </motion.div>
        ) : done && meta ? (
          <motion.div
            key={result.verdict}
            initial={{ opacity: 0, scale: 0.98, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className={`flex items-center justify-between rounded-md border px-4 py-3 ${meta.bg} ${meta.border}`}
          >
            <div className="flex items-center gap-3">
              <span className={`text-2xl leading-none ${meta.color}`}>
                {meta.glyph}
              </span>
              <div>
                <div className={`text-sm font-bold ${meta.color}`}>
                  {meta.label}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {meta.ok
                    ? `no counterexample in ${result.iterations} iterations`
                    : result.message ||
                      `counterexample forged at iteration #${result.failingCase?.iteration}`}
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="pending"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 rounded-md border border-border bg-[oklch(0.155_0.012_200)] px-4 py-3 text-sm text-muted-foreground"
          >
            <span className="sf-caret text-[var(--sf-green)]">
              {phase === "idle"
                ? "idle — configure and run a stress test"
                : phase === "submitting"
                  ? "submitting run"
                  : "forging counterexamples"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      {done && result && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="grid grid-cols-3 gap-2"
        >
          <Stat
            label="passed"
            value={`${result.iterationsPassed ?? 0}/${result.iterations ?? 0}`}
          />
          <Stat label="max time" value={`${result.maxTimeMs ?? 0}ms`} />
          <Stat
            label="verdict"
            value={meta?.ok ? "clean" : "broken"}
          />
        </motion.div>
      )}

      {/* Iteration strip */}
      {done && result && (result.perIter?.length ?? 0) > 0 && (
        <IterationStrip result={result} />
      )}

      {/* Compile error output */}
      {done && result?.verdict === "Compilation Error" && result.compilerOutput && (
        <div className="rounded-md border border-[oklch(0.72_0.17_300_/_0.4)] bg-[oklch(0.72_0.17_300_/_0.08)]">
          <div className="border-b border-border/60 px-3 py-1.5 text-[10px] uppercase tracking-widest text-[var(--sf-violet)]">
            {result.which ?? "compiler"} · g++ output
          </div>
          <pre className="sf-scroll max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-[12px] text-foreground/85">
            {result.compilerOutput}
          </pre>
        </div>
      )}

      {/* Counterexample diff */}
      {done && result?.failingCase && result.verdict && (
        <DiffView failingCase={result.failingCase} verdict={result.verdict} />
      )}
    </div>
  );
}

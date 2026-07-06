"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { CaseStatus, SubmissionCase, SubmissionResult } from "@/lib/types";
import type { Phase } from "@/lib/use-stress-run";
import { verdictMeta } from "@/lib/verdict";

interface SubmissionResultsProps {
  result: SubmissionResult | null;
  phase: Phase;
  error: string | null;
}

const STATUS_META: Record<
  CaseStatus,
  { label: string; color: string; border: string; bg: string; glyph: string }
> = {
  ok: {
    label: "OK",
    color: "text-[var(--sf-green)]",
    border: "border-[oklch(0.82_0.19_155_/_0.4)]",
    bg: "bg-[oklch(0.82_0.19_155_/_0.06)]",
    glyph: "✓",
  },
  wa: {
    label: "WRONG ANSWER",
    color: "text-[var(--sf-red)]",
    border: "border-[oklch(0.66_0.23_20_/_0.45)]",
    bg: "bg-[oklch(0.66_0.23_20_/_0.07)]",
    glyph: "✗",
  },
  tle: {
    label: "TLE",
    color: "text-[var(--sf-amber)]",
    border: "border-[oklch(0.78_0.16_80_/_0.45)]",
    bg: "bg-[oklch(0.78_0.16_80_/_0.07)]",
    glyph: "⧗",
  },
  re: {
    label: "RUNTIME ERROR",
    color: "text-[var(--sf-violet)]",
    border: "border-[oklch(0.72_0.17_300_/_0.45)]",
    bg: "bg-[oklch(0.72_0.17_300_/_0.07)]",
    glyph: "!",
  },
  unchecked: {
    label: "UNCHECKED",
    color: "text-[var(--sf-cyan)]",
    border: "border-[oklch(0.78_0.13_205_/_0.4)]",
    bg: "bg-[oklch(0.78_0.13_205_/_0.05)]",
    glyph: "◇",
  },
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-[oklch(0.155_0.012_200)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

function Pane({
  title,
  content,
  tone,
  empty,
}: {
  title: string;
  content?: string;
  tone: "neutral" | "good" | "bad";
  empty?: string;
}) {
  const toneClass =
    tone === "good"
      ? "border-[oklch(0.82_0.19_155_/_0.4)]"
      : tone === "bad"
        ? "border-[oklch(0.66_0.23_20_/_0.45)]"
        : "border-border";
  const labelClass =
    tone === "good"
      ? "text-[var(--sf-green)]"
      : tone === "bad"
        ? "text-[var(--sf-red)]"
        : "text-muted-foreground";
  return (
    <div className={`flex min-w-0 flex-col rounded border ${toneClass} bg-[oklch(0.15_0.01_200)]`}>
      <div
        className={`border-b border-border/50 px-2.5 py-1 text-[9.5px] uppercase tracking-widest ${labelClass}`}
      >
        {title}
      </div>
      <pre className="sf-scroll max-h-40 overflow-auto whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-foreground/90">
        {content && content.length > 0 ? (
          content
        ) : (
          <span className="text-muted-foreground/50">{empty ?? "(empty)"}</span>
        )}
      </pre>
    </div>
  );
}

function CaseRow({
  c,
  hasReference,
  index,
}: {
  c: SubmissionCase;
  hasReference: boolean;
  index: number;
}) {
  const m = STATUS_META[c.status];
  const showExpected = hasReference && c.status !== "re" && c.status !== "tle";
  const cols = showExpected ? "lg:grid-cols-3" : "lg:grid-cols-2";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.03, 0.3), ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-md border ${m.border} ${m.bg} p-2.5`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded bg-secondary px-2 py-0.5 text-muted-foreground">
          case <span className="text-foreground">#{c.index + 1}</span>
        </span>
        <span className={`inline-flex items-center gap-1 font-bold ${m.color}`}>
          <span>{m.glyph}</span>
          {m.label}
        </span>
        <span className="ml-auto rounded bg-secondary px-2 py-0.5 tabular-nums text-muted-foreground">
          {c.status === "tle" && c.timeLimitMs
            ? `${c.observedMs}ms / ${c.timeLimitMs}ms`
            : `${c.timeMs}ms`}
        </span>
        {c.overflowSuspected && (
          <span className="rounded border border-[oklch(0.78_0.16_80_/_0.5)] bg-[oklch(0.78_0.16_80_/_0.12)] px-2 py-0.5 text-[var(--sf-amber)]">
            ⚠ overflow suspected
          </span>
        )}
        {c.reason && (
          <span className="rounded border border-[oklch(0.72_0.17_300_/_0.45)] bg-[oklch(0.72_0.17_300_/_0.1)] px-2 py-0.5 text-[var(--sf-violet)]">
            {c.reason}
          </span>
        )}
      </div>
      <div className={`grid gap-2 ${cols}`}>
        <Pane title="input" content={c.input} tone="neutral" />
        <Pane
          title="output · optimized"
          content={c.output}
          tone={c.status === "ok" ? "good" : "bad"}
          empty={
            c.status === "tle"
              ? "(no output — timed out)"
              : c.status === "re"
                ? "(crashed)"
                : "(no output)"
          }
        />
        {showExpected && (
          <Pane title="expected · reference" content={c.expected} tone="good" />
        )}
      </div>
    </motion.div>
  );
}

export function SubmissionResults({ result, phase, error }: SubmissionResultsProps) {
  const meta = verdictMeta(result?.verdict);
  const done = phase === "done" && result;
  const cases = result?.cases ?? [];

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
                  {result.message ||
                    (result.hasReference
                      ? `${result.testsPassed ?? 0}/${result.testsRun ?? 0} cases matched the reference`
                      : `${result.testsRun ?? 0} cases ran — supply a reference to check correctness`)}
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
                ? "idle — paste inputs and run the solution"
                : phase === "submitting"
                  ? "submitting run"
                  : "running solution over inputs"}
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
            label={result.hasReference ? "passed" : "ran"}
            value={
              result.hasReference
                ? `${result.testsPassed ?? 0}/${result.testsRun ?? 0}`
                : (result.testsRun ?? 0)
            }
          />
          <Stat label="max time" value={`${result.maxTimeMs ?? 0}ms`} />
          <Stat label="verdict" value={meta?.ok ? "clean" : "broken"} />
        </motion.div>
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

      {/* Per-case table */}
      {done && cases.length > 0 && (
        <div className="sf-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
          {cases.map((c, i) => (
            <CaseRow
              key={c.index}
              c={c}
              index={i}
              hasReference={!!result?.hasReference}
            />
          ))}
        </div>
      )}
    </div>
  );
}

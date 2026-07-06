"use client";

import { motion } from "framer-motion";
import type { FailingCase, Verdict } from "@/lib/types";

interface DiffViewProps {
  failingCase: FailingCase;
  verdict: Verdict;
}

function OutputPane({
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
      ? "border-[oklch(0.82_0.19_155_/_0.45)] bg-[oklch(0.82_0.19_155_/_0.07)]"
      : tone === "bad"
        ? "border-[oklch(0.66_0.23_20_/_0.5)] bg-[oklch(0.66_0.23_20_/_0.08)]"
        : "border-border bg-[oklch(0.15_0.01_200)]";
  const labelClass =
    tone === "good"
      ? "text-[var(--sf-green)]"
      : tone === "bad"
        ? "text-[var(--sf-red)]"
        : "text-muted-foreground";

  return (
    <div className={`flex min-w-0 flex-col rounded-md border ${toneClass}`}>
      <div
        className={`flex items-center justify-between border-b border-border/60 px-3 py-1.5 text-[10px] uppercase tracking-widest ${labelClass}`}
      >
        <span>{title}</span>
      </div>
      <pre className="sf-scroll max-h-56 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground/90">
        {content && content.length > 0 ? content : (
          <span className="text-muted-foreground/50">{empty ?? "—"}</span>
        )}
      </pre>
    </div>
  );
}

/**
 * The forged counterexample: generated input alongside the oracle's expected
 * output and the optimized solution's actual output. Panes are tinted
 * green/red so a mismatch reads at a glance.
 */
export function DiffView({ failingCase, verdict }: DiffViewProps) {
  const fc = failingCase;
  const isMismatch = verdict === "Mismatch";
  const isTLE = verdict === "Time Limit Exceeded";
  const isRE = verdict === "Runtime Error";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded bg-secondary px-2 py-0.5 text-muted-foreground">
          iteration <span className="text-foreground">#{fc.iteration}</span>
        </span>
        <span className="rounded bg-secondary px-2 py-0.5 text-muted-foreground">
          seed <span className="text-foreground">{fc.seed}</span>
        </span>
        {fc.overflowSuspected && (
          <span className="rounded border border-[oklch(0.78_0.16_80_/_0.5)] bg-[oklch(0.78_0.16_80_/_0.12)] px-2 py-0.5 text-[var(--sf-amber)]">
            ⚠ overflow suspected
          </span>
        )}
        {typeof fc.observedMs === "number" && (
          <span className="rounded bg-secondary px-2 py-0.5 text-muted-foreground">
            {fc.observedMs}ms / {fc.timeLimitMs}ms
          </span>
        )}
        {fc.reason && (
          <span className="rounded border border-[oklch(0.72_0.17_300_/_0.45)] bg-[oklch(0.72_0.17_300_/_0.1)] px-2 py-0.5 text-[var(--sf-violet)]">
            {fc.reason}
          </span>
        )}
      </div>

      <div
        className={`grid gap-3 ${isMismatch ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}
      >
        <OutputPane title="generated input" content={fc.input} tone="neutral" />
        {(isMismatch || isTLE) && (
          <OutputPane
            title="expected · brute force"
            content={fc.expected}
            tone="good"
            empty={isTLE ? "(optimized never produced output)" : undefined}
          />
        )}
        {isMismatch && (
          <OutputPane title="actual · optimized" content={fc.actual} tone="bad" />
        )}
        {isRE && (
          <OutputPane
            title="crash detail"
            content={fc.reason}
            tone="bad"
            empty="(no stderr captured)"
          />
        )}
      </div>
    </motion.div>
  );
}

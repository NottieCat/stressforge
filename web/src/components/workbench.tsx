"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { StressWorkbench } from "@/components/stress-workbench";
import { SubmissionWorkbench } from "@/components/submission-workbench";

type Mode = "generator" | "submission";

const MODES: { key: Mode; label: string; hint: string }[] = [
  {
    key: "generator",
    label: "generator mode",
    hint: "auto-forge random tests · brute vs. optimized",
  },
  {
    key: "submission",
    label: "submission mode",
    hint: "run explicit inputs you paste or upload",
  },
];

export function Workbench() {
  const [mode, setMode] = useState<Mode>("generator");

  return (
    <div className="flex flex-col">
      {/* Mode switcher */}
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-5 pt-4">
        <div className="relative inline-flex rounded-lg border border-border bg-secondary/50 p-1">
          {MODES.map((m) => {
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                className={`relative z-10 rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  active ? "text-[oklch(0.17_0.03_180)]" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="mode-pill"
                    className="absolute inset-0 -z-10 rounded-md bg-[var(--sf-green)]"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                {m.label}
              </button>
            );
          })}
        </div>
        <AnimatePresence mode="wait">
          <motion.span
            key={mode}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.2 }}
            className="hidden text-[11px] text-muted-foreground sm:inline"
          >
            {MODES.find((m) => m.key === mode)?.hint}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Active workbench. Keyed so mount animations replay on switch; the two
          hooks own independent run state, so switching cleanly abandons any
          in-flight poll of the other mode. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          {mode === "generator" ? <StressWorkbench /> : <SubmissionWorkbench />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

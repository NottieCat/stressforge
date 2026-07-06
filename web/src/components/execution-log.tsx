"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import type { Phase } from "@/lib/use-stress-run";

interface ExecutionLogProps {
  lines: string[];
  phase: Phase;
}

const glyphFor = (line: string) => {
  if (line.startsWith("✓")) return { g: "✓", c: "text-[var(--sf-green)]" };
  if (line.startsWith("✗")) return { g: "✗", c: "text-[var(--sf-red)]" };
  return { g: "›", c: "text-[var(--sf-cyan)]" };
};

/**
 * Terminal-style live log. New lines fade/slide in; the view auto-scrolls to
 * the tail. While running, a blinking caret sits under the last line.
 */
export function ExecutionLog({ lines, phase }: ExecutionLogProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines.length, phase]);

  const running = phase === "running" || phase === "submitting";

  return (
    <div className="sf-scroll h-full overflow-auto rounded-md border border-border bg-[oklch(0.14_0.01_200)] p-3 font-mono text-[12.5px] leading-relaxed">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        <span className="size-2 rounded-full bg-[oklch(0.66_0.23_20)]" />
        <span className="size-2 rounded-full bg-[oklch(0.78_0.16_80)]" />
        <span className="size-2 rounded-full bg-[oklch(0.82_0.19_155)]" />
        <span className="ml-2">execution log</span>
      </div>

      {lines.length === 0 && !running && (
        <p className="text-muted-foreground/60">
          <span className="text-[var(--sf-green)]">stressforge</span>
          <span className="text-muted-foreground"> ~ $ </span>
          waiting for a run…
        </p>
      )}

      <AnimatePresence initial={false}>
        {lines.map((line, i) => {
          const { g, c } = glyphFor(line);
          const isLast = i === lines.length - 1;
          return (
            <motion.div
              key={`${i}-${line}`}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className={`flex gap-2 ${isLast && running ? "sf-caret" : ""}`}
            >
              <span className={`${c} select-none`}>{g}</span>
              <span className="text-foreground/90 whitespace-pre-wrap break-words">
                {line.replace(/^[✓✗]\s*/, "")}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {running && lines.length === 0 && (
        <div className="sf-caret text-[var(--sf-green)]">booting sandbox…</div>
      )}
      <div ref={endRef} />
    </div>
  );
}

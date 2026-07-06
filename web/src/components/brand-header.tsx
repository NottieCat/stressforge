"use client";

import { motion } from "framer-motion";
import { API_BASE } from "@/lib/api";

/**
 * StressForge wordmark + tagline. The mark animates in on load with a short
 * transform/opacity tween (GPU-friendly, no layout properties => no jitter).
 */
export function BrandHeader() {
  return (
    <header className="border-b border-border/70 backdrop-blur-sm sticky top-0 z-30 bg-background/70">
      <div className="mx-auto max-w-[1600px] px-5 py-3 flex items-center justify-between gap-4">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center gap-3"
        >
          <div className="sf-ring-glow grid size-9 place-items-center rounded-md border border-[oklch(0.82_0.19_155_/_0.4)] bg-[oklch(0.82_0.19_155_/_0.08)]">
            <span className="text-[var(--sf-green)] text-lg leading-none">⌇</span>
          </div>
          <div className="leading-tight">
            <h1 className="text-base font-bold tracking-tight">
              <span className="text-foreground">Stress</span>
              <span className="text-[var(--sf-green)] sf-glow">Forge</span>
            </h1>
            <p className="text-[11px] text-muted-foreground -mt-0.5">
              forge counterexamples for your C++ solutions
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="hidden sm:flex items-center gap-2 text-[11px] text-muted-foreground"
        >
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-[var(--sf-green)] shadow-[0_0_8px_var(--sf-green)]" />
            sandboxed · docker + cgroups
          </span>
          <span className="text-border">|</span>
          <span className="font-mono opacity-70">{API_BASE.replace(/^https?:\/\//, "")}</span>
        </motion.div>
      </div>
    </header>
  );
}

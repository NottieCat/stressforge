import type { Verdict } from "./types";

export interface VerdictMeta {
  label: string;
  // Tailwind-ish token classes mapped to our semantic accent CSS vars.
  color: string; // text color class
  bg: string; // subtle background
  border: string;
  glyph: string; // short terminal glyph
  ok: boolean; // green (pass) vs. failure styling
}

export const VERDICT_META: Record<Verdict, VerdictMeta> = {
  Accepted: {
    label: "Accepted",
    color: "text-[var(--sf-green)]",
    bg: "bg-[oklch(0.82_0.19_155_/_0.10)]",
    border: "border-[oklch(0.82_0.19_155_/_0.4)]",
    glyph: "✓",
    ok: true,
  },
  Mismatch: {
    label: "Mismatch",
    color: "text-[var(--sf-red)]",
    bg: "bg-[oklch(0.66_0.23_20_/_0.12)]",
    border: "border-[oklch(0.66_0.23_20_/_0.45)]",
    glyph: "≠",
    ok: false,
  },
  "Time Limit Exceeded": {
    label: "Time Limit Exceeded",
    color: "text-[var(--sf-amber)]",
    bg: "bg-[oklch(0.78_0.16_80_/_0.12)]",
    border: "border-[oklch(0.78_0.16_80_/_0.45)]",
    glyph: "⧗",
    ok: false,
  },
  "Runtime Error": {
    label: "Runtime Error",
    color: "text-[var(--sf-violet)]",
    bg: "bg-[oklch(0.72_0.17_300_/_0.12)]",
    border: "border-[oklch(0.72_0.17_300_/_0.45)]",
    glyph: "!",
    ok: false,
  },
  "Compilation Error": {
    label: "Compilation Error",
    color: "text-[var(--sf-violet)]",
    bg: "bg-[oklch(0.72_0.17_300_/_0.12)]",
    border: "border-[oklch(0.72_0.17_300_/_0.45)]",
    glyph: "⚙",
    ok: false,
  },
  "Generator Error": {
    label: "Generator Error",
    color: "text-[var(--sf-amber)]",
    bg: "bg-[oklch(0.78_0.16_80_/_0.12)]",
    border: "border-[oklch(0.78_0.16_80_/_0.45)]",
    glyph: "⚡",
    ok: false,
  },
  "Wrong Answer": {
    label: "Wrong Answer",
    color: "text-[var(--sf-red)]",
    bg: "bg-[oklch(0.66_0.23_20_/_0.12)]",
    border: "border-[oklch(0.66_0.23_20_/_0.45)]",
    glyph: "✗",
    ok: false,
  },
  "No Crash (unchecked)": {
    label: "No Crash · unchecked",
    color: "text-[var(--sf-cyan)]",
    bg: "bg-[oklch(0.78_0.13_205_/_0.10)]",
    border: "border-[oklch(0.78_0.13_205_/_0.4)]",
    glyph: "◇",
    ok: true,
  },
};

// Keys use the token-class strings above; glyph typo-guard.
export function verdictMeta(v?: Verdict | null): VerdictMeta | null {
  if (!v) return null;
  const m = VERDICT_META[v];
  return m ?? null;
}

"use client";

import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CodeEditor } from "@/components/code-editor";
import { SubmissionResults } from "@/components/submission-results";
import { useSubmissionRun } from "@/lib/use-submission-run";
import {
  SAMPLE_SUB_OPTIMIZED,
  SAMPLE_SUB_REFERENCE,
  SAMPLE_SUB_TESTS,
} from "@/lib/samples";

const fade = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

type SubTab = "optimized" | "reference";

/** Split a pasted blob into individual cases on a line of only dashes. */
function parseCases(raw: string): string[] {
  return raw
    .split(/^\s*-{3,}\s*$/m)
    .map((c) => c.replace(/^\n+/, "").replace(/\s+$/, ""))
    .filter((c) => c.length > 0);
}

export function SubmissionWorkbench() {
  const [optimized, setOptimized] = useState(SAMPLE_SUB_OPTIMIZED);
  const [reference, setReference] = useState(SAMPLE_SUB_REFERENCE);
  const [useReference, setUseReference] = useState(true);
  const [testsRaw, setTestsRaw] = useState(SAMPLE_SUB_TESTS);
  const [timeLimitMs, setTimeLimitMs] = useState(2000);
  const [tab, setTab] = useState<SubTab>("optimized");
  const fileRef = useRef<HTMLInputElement>(null);

  const { phase, result, error, run, reset } = useSubmissionRun();
  const busy = phase === "submitting" || phase === "running";

  const cases = useMemo(() => parseCases(testsRaw), [testsRaw]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setTestsRaw(text);
    toast.message("File loaded", { description: file.name });
    e.target.value = ""; // allow re-uploading the same file
  };

  const onRun = () => {
    if (!optimized.trim()) {
      toast.error("optimized.cpp is empty");
      setTab("optimized");
      return;
    }
    if (useReference && !reference.trim()) {
      toast.error("reference.cpp is empty");
      setTab("reference");
      return;
    }
    if (cases.length === 0) {
      toast.error("No test cases — paste at least one input");
      return;
    }
    if (cases.length > 50) {
      toast.error(`Too many cases (${cases.length}) — max 50 per run`);
      return;
    }
    run({
      sourceCode: optimized,
      tests: cases,
      reference: useReference ? { sourceCode: reference } : undefined,
      timeLimitMs,
    });
    toast.message("Run queued", {
      description: `${cases.length} case${cases.length === 1 ? "" : "s"} · ${timeLimitMs}ms limit`,
    });
  };

  return (
    <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      {/* ---------------- Left: editors + inputs + config ---------------- */}
      <motion.section
        {...fade}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card/40 p-3"
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList className="bg-secondary/60">
              <TabsTrigger
                value="optimized"
                className="data-[state=active]:bg-background text-xs"
              >
                <span className="text-[var(--sf-amber)]">●</span>&nbsp;optimized.cpp
              </TabsTrigger>
              <TabsTrigger
                value="reference"
                disabled={!useReference}
                className="data-[state=active]:bg-background text-xs disabled:opacity-40"
              >
                <span className="text-[var(--sf-green)]">●</span>&nbsp;reference.cpp
              </TabsTrigger>
            </TabsList>

            <button
              type="button"
              onClick={() => setUseReference((v) => !v)}
              disabled={busy}
              className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                useReference
                  ? "border-[oklch(0.82_0.19_155_/_0.5)] bg-[oklch(0.82_0.19_155_/_0.1)] text-[var(--sf-green)]"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {useReference ? "✓ " : ""}diff against reference
            </button>
          </div>

          <TabsContent value="optimized" className="mt-3">
            <p className="mb-2 text-[11px] text-muted-foreground">
              solution under test · reads each case from stdin, prints its answer
            </p>
            <CodeEditor
              value={optimized}
              onChange={setOptimized}
              ariaLabel="optimized.cpp"
              minRows={16}
            />
          </TabsContent>
          <TabsContent value="reference" className="mt-3">
            <p className="mb-2 text-[11px] text-muted-foreground">
              trusted oracle · its output is the expected answer per case (WA
              detection)
            </p>
            <CodeEditor
              value={reference}
              onChange={setReference}
              ariaLabel="reference.cpp"
              minRows={16}
            />
          </TabsContent>
        </Tabs>

        {/* Explicit test cases */}
        <div className="rounded-md border border-border bg-[oklch(0.155_0.012_200)] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">
              test cases ·{" "}
              <span className="text-[var(--sf-green)]">{cases.length}</span>{" "}
              parsed
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/70">
                separate cases with a line of{" "}
                <code className="text-[var(--sf-cyan)]">---</code>
              </span>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.in,text/plain"
                onChange={onUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="h-7 border-border px-2 text-[11px]"
              >
                ⬆ upload
              </Button>
            </div>
          </div>
          <textarea
            value={testsRaw}
            onChange={(e) => setTestsRaw(e.target.value)}
            disabled={busy}
            spellCheck={false}
            aria-label="test cases"
            className="sf-scroll sf-code h-40 w-full resize-y rounded border border-border bg-[oklch(0.14_0.01_200)] px-3 py-2 font-mono text-[12.5px] leading-relaxed text-foreground/90 outline-none focus:border-[oklch(0.82_0.19_155_/_0.5)] disabled:opacity-60"
            style={{
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            }}
          />
        </div>

        {/* Config + actions */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1 space-y-2">
            <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">
              time limit (ms) · per case
            </Label>
            <Input
              type="number"
              min={100}
              max={10000}
              step={100}
              value={timeLimitMs}
              disabled={busy}
              onChange={(e) =>
                setTimeLimitMs(
                  Math.max(100, Math.min(10000, Number(e.target.value) || 0)),
                )
              }
              className="font-mono"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={onRun}
              disabled={busy}
              className="bg-[var(--sf-green)] font-bold text-[oklch(0.17_0.03_180)] hover:bg-[oklch(0.86_0.19_155)] disabled:opacity-60"
            >
              {busy ? (
                <span className="sf-caret">running</span>
              ) : (
                <>▶ run submission</>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={reset}
              disabled={busy}
              className="border-border"
            >
              reset
            </Button>
          </div>
        </div>
      </motion.section>

      {/* ---------------- Right: per-case results ---------------- */}
      <motion.section
        {...fade}
        transition={{ duration: 0.4, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        className="flex min-h-0 min-w-0 flex-col rounded-lg border border-border bg-card/40 p-3"
      >
        <SubmissionResults result={result} phase={phase} error={error} />
      </motion.section>
    </div>
  );
}

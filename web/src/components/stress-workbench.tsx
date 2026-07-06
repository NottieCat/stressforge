"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { CodeEditor } from "@/components/code-editor";
import { ExecutionLog } from "@/components/execution-log";
import { ResultsPanel } from "@/components/results-panel";
import { useStressRun } from "@/lib/use-stress-run";
import { ApiError, generateScript } from "@/lib/api";
import type { EditorKey } from "@/lib/types";
import {
  SAMPLE_BRUTE,
  SAMPLE_GENERATOR,
  SAMPLE_OPTIMIZED,
} from "@/lib/samples";

const TABS: { key: EditorKey; label: string; hint: string; accent: string }[] = [
  {
    key: "generator",
    label: "generator.cpp",
    hint: "emits one random test per run · argv[1] = seed",
    accent: "text-[var(--sf-cyan)]",
  },
  {
    key: "brute",
    label: "brute.cpp",
    hint: "trusted oracle · reads stdin, prints answer",
    accent: "text-[var(--sf-green)]",
  },
  {
    key: "optimized",
    label: "optimized.cpp",
    hint: "solution under test · compared against brute",
    accent: "text-[var(--sf-amber)]",
  },
];

const fade = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

export function StressWorkbench() {
  const [sources, setSources] = useState<Record<EditorKey, string>>({
    generator: SAMPLE_GENERATOR,
    brute: SAMPLE_BRUTE,
    optimized: SAMPLE_OPTIMIZED,
  });
  const [iterations, setIterations] = useState(100);
  const [timeLimitMs, setTimeLimitMs] = useState(2000);
  const [tab, setTab] = useState<EditorKey>("optimized");

  // Auto-Parser: paste a problem URL, have the backend scrape + LLM-write gen.cpp.
  const [problemUrl, setProblemUrl] = useState("");
  const [autoLoading, setAutoLoading] = useState(false);

  const { phase, result, error, run, reset } = useStressRun();
  const busy = phase === "submitting" || phase === "running";

  const logLines = useMemo(() => result?.log ?? [], [result]);

  const setSource = (key: EditorKey, v: string) =>
    setSources((s) => ({ ...s, [key]: v }));

  const onAutoGenerate = async () => {
    const url = problemUrl.trim();
    if (!url) {
      toast.error("Paste a Codeforces or CodeChef problem URL first");
      return;
    }
    setAutoLoading(true);
    try {
      const res = await generateScript(url);
      if (res.is_fixed_input) {
        // Predefined test cases — nothing to randomize. Leave the editor as-is.
        toast.info(
          "This problem uses fixed test cases. Please switch to Submission Mode to paste them directly.",
        );
        return;
      }
      if (res.code) {
        setSource("generator", res.code);
        setTab("generator");
        toast.success("Generator forged from problem constraints");
      } else {
        toast.error("No generator was returned. Try again or write it manually.");
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Auto-generate failed";
      toast.error(msg);
    } finally {
      setAutoLoading(false);
    }
  };

  const onRun = () => {
    for (const t of TABS) {
      if (!sources[t.key].trim()) {
        toast.error(`${t.label} is empty`);
        setTab(t.key);
        return;
      }
    }
    run({
      generator: { sourceCode: sources.generator },
      brute: { sourceCode: sources.brute },
      optimized: { sourceCode: sources.optimized },
      iterations,
      timeLimitMs,
    });
    toast.message("Run queued", {
      description: `${iterations} iterations · ${timeLimitMs}ms limit`,
    });
  };

  return (
    <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      {/* ---------------- Left: editors + config ---------------- */}
      <motion.section
        {...fade}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card/40 p-3"
      >
        {/* Auto-Parser: URL -> scraped constraints -> LLM-written generator.cpp */}
        <div className="flex flex-col gap-2 rounded-md border border-border bg-[oklch(0.155_0.012_200)] p-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Label
              htmlFor="problem-url"
              className="text-[11px] uppercase tracking-widest text-muted-foreground"
            >
              problem url · auto-parser
            </Label>
            <Input
              id="problem-url"
              type="url"
              inputMode="url"
              placeholder="https://codeforces.com/problemset/problem/1/A"
              value={problemUrl}
              disabled={autoLoading || busy}
              onChange={(e) => setProblemUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !autoLoading && !busy) onAutoGenerate();
              }}
              className="font-mono text-xs"
            />
          </div>
          <Button
            type="button"
            onClick={onAutoGenerate}
            disabled={autoLoading || busy}
            className="bg-[var(--sf-cyan)] font-bold text-[oklch(0.17_0.03_180)] hover:bg-[oklch(0.86_0.13_210)] disabled:opacity-60 sm:mt-[18px]"
          >
            {autoLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                &nbsp;forging
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                &nbsp;auto-generate
              </>
            )}
          </Button>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as EditorKey)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList className="bg-secondary/60">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.key}
                  value={t.key}
                  className="data-[state=active]:bg-background text-xs"
                >
                  <span className={t.accent}>●</span>&nbsp;{t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {TABS.map((t) => (
            <TabsContent key={t.key} value={t.key} className="mt-3">
              <p className="mb-2 text-[11px] text-muted-foreground">{t.hint}</p>
              <CodeEditor
                value={sources[t.key]}
                onChange={(v) => setSource(t.key, v)}
                ariaLabel={t.label}
                minRows={18}
              />
            </TabsContent>
          ))}
        </Tabs>

        {/* Config row */}
        <div className="grid grid-cols-1 gap-4 rounded-md border border-border bg-[oklch(0.155_0.012_200)] p-3 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">
                iterations
              </Label>
              <span className="font-mono text-sm text-[var(--sf-green)]">
                {iterations}
              </span>
            </div>
            <Slider
              value={[iterations]}
              min={10}
              max={500}
              step={10}
              disabled={busy}
              onValueChange={(v) => setIterations(Array.isArray(v) ? v[0] : v)}
            />
          </div>

          <div className="space-y-2">
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
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={onRun}
            disabled={busy}
            className="flex-1 bg-[var(--sf-green)] font-bold text-[oklch(0.17_0.03_180)] hover:bg-[oklch(0.86_0.19_155)] disabled:opacity-60"
          >
            {busy ? (
              <span className="sf-caret">forging</span>
            ) : (
              <>▶ run stress test</>
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
      </motion.section>

      {/* ---------------- Right: log + results ---------------- */}
      <motion.section
        {...fade}
        transition={{ duration: 0.4, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        className="flex min-w-0 flex-col gap-3"
      >
        <div className="h-[240px] shrink-0">
          <ExecutionLog lines={logLines} phase={phase} />
        </div>
        <div className="min-h-0 flex-1 rounded-lg border border-border bg-card/40 p-3">
          <ResultsPanel result={result} phase={phase} error={error} />
        </div>
      </motion.section>
    </div>
  );
}

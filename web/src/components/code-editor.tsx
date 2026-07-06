"use client";

import { useEffect } from "react";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import { cn } from "@/lib/utils";

interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  className?: string;
  minRows?: number;
  ariaLabel?: string;
}

/**
 * Lightweight controlled C++ editor: react-simple-code-editor + Prism.
 * Chosen over Monaco to keep the bundle small and mounts jitter-free — it's a
 * styled textarea overlaying highlighted markup, so there's no async editor
 * boot and no layout shift on mount.
 */
export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  className,
  minRows = 14,
  ariaLabel,
}: CodeEditorProps) {
  // Ensure grammar is present (defensive; imports above already register it).
  useEffect(() => {
    void Prism.languages.cpp;
  }, []);

  return (
    <div
      className={cn(
        "sf-scroll relative overflow-auto rounded-md border border-border bg-[oklch(0.155_0.012_200)]",
        className,
      )}
      style={{ minHeight: `${minRows * 1.5 + 1.5}rem` }}
    >
      <Editor
        value={value}
        onValueChange={(code) => !readOnly && onChange(code)}
        highlight={(code) =>
          Prism.highlight(code, Prism.languages.cpp, "cpp")
        }
        padding={16}
        textareaClassName="sf-code focus:outline-none"
        preClassName="sf-code"
        aria-label={ariaLabel}
        readOnly={readOnly}
        style={{
          fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
          fontSize: 13,
          lineHeight: 1.55,
          minHeight: `${minRows * 1.5}rem`,
        }}
      />
    </div>
  );
}

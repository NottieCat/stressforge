import { BrandHeader } from "@/components/brand-header";
import { Workbench } from "@/components/workbench";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <BrandHeader />
      <main className="flex-1">
        <Workbench />
      </main>
      <footer className="border-t border-border/60 px-5 py-3 text-center text-[11px] text-muted-foreground">
        <span className="text-[var(--sf-green)]">StressForge</span> · generator
        vs. brute-force vs. optimized · executed in isolated Docker sandboxes
      </footer>
    </div>
  );
}

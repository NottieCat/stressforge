import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "StressForge — algorithmic stress testing",
  description:
    "Forge counterexamples for your C++ solutions. Generate, brute-force, optimize, and diff — inside isolated Docker sandboxes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${jetbrains.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast:
                "!bg-card !border-border !text-foreground !font-mono !text-xs",
            },
          }}
        />
      </body>
    </html>
  );
}

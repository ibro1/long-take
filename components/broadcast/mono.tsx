import type { ReactNode } from "react";

import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * Any number that ticks.
 *
 * Tabular figures are the whole point: a bitrate or a stopwatch rendered in
 * proportional digits shifts sideways every time a 1 becomes an 8, and an
 * operator glancing at it mid-broadcast reads movement that is not there. The
 * numerals are pinned to one width so only the value changes.
 */
export function Mono({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Text
      className={cn("font-mono text-white", className)}
      // The head-up cap (chrome.tsx's HUD_TEXT), written out rather than
      // imported because chrome imports this file.
      maxFontSizeMultiplier={1.3}
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {children}
    </Text>
  );
}

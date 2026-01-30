"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface TypewriterProps {
  text: string;
  delay?: number;
  baseText?: string;
  speedMs?: number;
  className?: string;
}

export function Typewriter({
  text,
  delay = 0,
  baseText = "",
  speedMs = 45,
  className,
}: TypewriterProps) {
  const safeText = useMemo(() => text ?? "", [text]);
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    setCharIndex(0);
  }, [safeText]);

  useEffect(() => {
    if (!safeText) return;
    const timeout = setTimeout(
      () => {
        if (charIndex < safeText.length) {
          setCharIndex((prev) => prev + 1);
        }
      },
      delay > 0 && charIndex === 0 ? delay * 1000 : speedMs
    );

    return () => clearTimeout(timeout);
  }, [charIndex, delay, safeText, speedMs]);

  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {baseText}
      {safeText.slice(0, charIndex)}
    </span>
  );
}

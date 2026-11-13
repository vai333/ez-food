"use client";
import { useEffect, useRef, useState } from "react";

/** Headline whose words light up as it scrolls through the viewport (reference-site style). */
export function ScrollWords({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [lit, setLit] = useState(0);
  const words = text.split(" ");
  useEffect(() => {
    const onScroll = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
      setLit(Math.round(p * words.length));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [words.length]);
  return (
    <p ref={ref} className={className}>
      {words.map((w, i) => (
        <span key={i} className={`scroll-word ${i < lit ? "on" : ""}`}>{w} </span>
      ))}
    </p>
  );
}

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-[var(--line)] border-y hair">
      {items.map((it, i) => (
        <div key={i}>
          <button className="w-full flex items-center justify-between gap-4 py-6 text-left" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            <span className="text-[20px] md:text-[24px] font-semibold tracking-[-0.03em]">{it.q}</span>
            <span className={`corner shrink-0 transition-transform ${open === i ? "rotate-45" : ""}`}>+</span>
          </button>
          {open === i && <p className="muted pb-6 max-w-3xl rise">{it.a}</p>}
        </div>
      ))}
    </div>
  );
}

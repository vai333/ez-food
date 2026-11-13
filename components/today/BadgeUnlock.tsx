"use client";
import { useState } from "react";
import { BADGE_ICON } from "../ui";
import { haptic } from "@/lib/client/api";
import { useEffect } from "react";

type B = { id: string; title: string; detail: string; icon: string; tier: string };

export function BadgeUnlock({ ids, badges, onDone }: { ids: string[]; badges: B[]; onDone: () => void }) {
  const list = ids.map((id) => badges.find((b) => b.id === id)).filter(Boolean) as B[];
  const [i, setI] = useState(0);
  useEffect(() => {
    haptic([20, 80, 20, 80, 40]);
  }, [i]);
  const b = list[i];
  if (!b) return null;
  const Icon = BADGE_ICON[b.icon] ?? BADGE_ICON.star;
  const next = () => (i < list.length - 1 ? setI(i + 1) : onDone());
  return (
    <div className="fixed inset-0 z-[65] grid place-items-center bg-black/85 backdrop-blur px-6 overflow-hidden" role="dialog" aria-label="Badge unlocked">
      <div className="text-center pop max-w-sm" key={b.id}>
        <div className="glow" style={{ width: 360, height: 360, top: "30%", left: "50%", marginLeft: -180 }} />
        <p className="eyebrow">Badge unlocked · {b.tier}</p>
        <div className="mx-auto mt-6 w-32 h-32 rounded-full grid place-items-center pulse-ring" style={{ background: b.tier === "gold" ? "radial-gradient(circle at 30% 25%, #fff, #bdbdc4 70%)" : b.tier === "silver" ? "radial-gradient(circle at 30% 25%, #f5f5f7, #8d8d94 75%)" : "radial-gradient(circle at 30% 25%, #e8e8ec, #5e5e66 80%)" }}>
          <Icon size={54} color="#000" strokeWidth={1.5} />
        </div>
        <h3 className="h2 mt-6">{b.title}</h3>
        <p className="muted mt-2">{b.detail}</p>
        <button className="btn btn-primary mt-8" onClick={next}>{i < list.length - 1 ? "Next" : "Keep going"}</button>
      </div>
    </div>
  );
}

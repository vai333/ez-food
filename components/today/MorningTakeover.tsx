"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { TodayMeal, TodayPayload } from "@/lib/server/today";
import { fmt12 } from "@/lib/time";
import { haptic } from "@/lib/client/api";
import { Art } from "../ui";

/** Flow A: full-screen morning activation. One big button. */
export function MorningTakeover({ name, meals, prep, onDone, autoDone }: { name: string; meal: TodayMeal; meals: TodayMeal[]; prep: TodayPayload["prep"]; onDone: () => Promise<void>; autoDone?: boolean }) {
  const [stage, setStage] = useState<"ask" | "done">("ask");
  const [showRecipe, setShowRecipe] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fired = useRef(false);

  const done = async () => {
    if (fired.current) return;
    fired.current = true;
    haptic([12, 60, 24]);
    setStage("done");
    await onDone();
  };
  useEffect(() => {
    if (autoDone) void done();
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSip = () => {
    const end = Date.now() + 60_000;
    setLeft(60);
    timer.current = setInterval(() => {
      const l = Math.max(0, Math.round((end - Date.now()) / 1000));
      setLeft(l);
      if (l === 0 && timer.current) { clearInterval(timer.current); haptic(30); }
    }, 250);
  };

  return (
    <div className="fixed inset-0 z-[55] bg-black overflow-y-auto overflow-x-hidden" role="dialog" aria-label="Morning activation">
      <div className="glow" style={{ width: 600, height: 600, top: -200, left: "50%", marginLeft: -300, background: "radial-gradient(circle, rgba(255,255,255,.22), transparent 70%)" }} />
      <div className="relative min-h-dvh max-w-[520px] mx-auto px-6 pt-[max(48px,env(safe-area-inset-top))] pb-10 flex flex-col">
        {stage === "ask" ? (
          <>
            <span className="pill self-start rise"><span className="dot" />Morning · {new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            <h1 className="display mt-8 rise" style={{ fontSize: "clamp(52px,15vw,84px)" }}>Good morning,<br /><span className="fade-tail">{name}.</span></h1>
            <p className="text-xl muted mt-5 rise">Time for your warm ginger water.</p>
            <div className="mt-10 grid place-items-center rise">
              <Art k="ginger" box={150} size={64} className="pulse-ring" />
            </div>
            <button className="card mt-10 p-4 text-left w-full" onClick={() => setShowRecipe((s) => !s)} aria-expanded={showRecipe}>
              <span className="flex items-center justify-between font-semibold">3 ingredients · 2 min <ChevronDown size={18} className={showRecipe ? "rotate-180" : ""} /></span>
              {showRecipe && (
                <ul className="mt-3 space-y-1.5 muted text-[15px]">
                  <li>1 cup warm water</li><li>½ inch fresh ginger, grated</li><li>A pinch of turmeric</li><li>A dash of black pepper (pairs well with turmeric)</li>
                </ul>
              )}
            </button>
            <button className="btn btn-ghost mt-3" onClick={startSip} disabled={left !== null && left > 0}>{left === null ? "Start a 60-second stir & sip" : left > 0 ? `Sip slowly… ${left}s` : "Lovely. All done?"}</button>
            <div className="flex-1" />
            <button className="btn btn-primary btn-lg w-full mt-8 !min-h-[68px] !text-xl" onClick={done}>Done</button>
            <p className="text-center text-xs faint mt-3">+15 XP · counts toward your day chain</p>
          </>
        ) : (
          <>
            <div className="leaf-unfurl self-center mt-10 w-24 h-24 rounded-full bg-white grid place-items-center"><Check size={44} color="#000" /></div>
            <h2 className="h2 text-center mt-8 rise">First sip done.<br /><span className="fade-tail">Here&apos;s your day.</span></h2>
            <div className="mt-8 space-y-2 rise">
              {meals.filter((m) => m.slot !== "wake").map((m) => (
                <div key={m.id} className="card p-4 flex items-center gap-3">
                  <span className="tabular font-semibold w-[70px]">{fmt12(m.start)}</span>
                  <span className="flex-1"><span className="eyebrow block">{m.label}</span>{m.recipes.map((r) => r.titleEn).join(" + ")}</span>
                </div>
              ))}
              {prep.slice(0, 2).map((p) => <div key={p.id} className="card p-4 text-sm"><span className="eyebrow block">Prep · {p.due}</span>{p.instruction}</div>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

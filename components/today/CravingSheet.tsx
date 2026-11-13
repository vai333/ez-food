"use client";
import Link from "next/link";
import { useState } from "react";
import { Info, Sparkles } from "lucide-react";
import type { TodayMeal } from "@/lib/server/today";
import { post } from "@/lib/client/api";
import type { TasteTag } from "@/lib/types";
import { Art, Sheet, type RewardT } from "../ui";

const CHIPS: { tag: TasteTag; label: string }[] = [
  { tag: "sweet", label: "Sweet" }, { tag: "savory", label: "Savory" }, { tag: "crunchy", label: "Crunchy" }, { tag: "spicy", label: "Spicy" },
  { tag: "light", label: "Light" }, { tag: "heavy", label: "Heavy" }, { tag: "tangy", label: "Tangy" }, { tag: "warm", label: "Warm" }, { tag: "cool", label: "Cool" }, { tag: "comfort", label: "Comfort" },
];

type Cand = { slug: string; title: string; titleHi?: string; activeMinutes: number; passiveMinutes: number; tasteTags: string[]; art?: string; origin: string; why: string; ingredients: string[] };

/** Flow C: craving chips → one hero suggestion with "why this" → next. One refinement question after 2 rejections. */
export function CravingSheet({ meal, onClose, onDone }: { meal: TodayMeal | null; onClose: () => void; onDone: (r: RewardT[]) => void }) {
  const [picked, setPicked] = useState<TasteTag[]>([]);
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [rejected, setRejected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [spicy, setSpicy] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  const [refine, setRefine] = useState(false);
  const [budget, setBudget] = useState<number | undefined>(undefined);

  const run = async (tags: TasteTag[], exclude: string[] = [], timeBudget = budget) => {
    if (!meal) return;
    setLoading(true);
    try {
      const r = await post<{ candidates: Cand[]; aiNote?: string; spicyNote: string | null; source: string }>("/api/craving/suggest", { mealId: meal.id, cravings: tags, exclude, timeBudget });
      setCands(r.candidates);
      setIdx(0);
      setNote(r.aiNote ?? (r.source !== "curated" ? "Fresh idea from Gemini, checked by the safety council and EZ FOOD's validator." : null));
      if (!r.candidates.length && !r.aiNote) setNote(null);
      setSpicy(r.spicyNote);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't fetch ideas");
    } finally {
      setLoading(false);
    }
  };

  const reject = async () => {
    const c = cands?.[idx];
    if (!c) return;
    void post("/api/craving/respond", { action: "reject", mealId: meal!.id, slug: c.slug, cravings: picked }, { queueable: true });
    const nextRejected = [...rejected, c.slug];
    setRejected(nextRejected);
    if (nextRejected.length === 2 && !refine) { setRefine(true); return; }
    if (cands && idx < cands.length - 1) setIdx(idx + 1);
    else await run(picked, nextRejected);
  };

  const accept = async () => {
    const c = cands?.[idx];
    if (!c || !meal) return;
    const r = await post<{ rewards: RewardT[] }>("/api/craving/respond", { action: "accept", mealId: meal.id, slug: c.slug, cravings: picked }, { queueable: true });
    onDone(r.rewards ?? []);
  };

  const c = cands?.[idx];
  return (
    <Sheet open={!!meal} onClose={onClose} title={cands ? "Try this instead" : "What are you craving?"} tall>
      {!cands && (
        <>
          <p className="muted mb-4">Pick any. Every option stays nightshade-free, chilli-free and ≤ 1 tsp fat.</p>
          <div className="flex flex-wrap gap-2">
            {CHIPS.map((ch) => (
              <button key={ch.tag} className="chip" aria-pressed={picked.includes(ch.tag)} onClick={() => setPicked((p) => (p.includes(ch.tag) ? p.filter((x) => x !== ch.tag) : [...p, ch.tag]))}>{ch.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 mt-6">
            <button className="btn btn-primary btn-lg" disabled={loading} onClick={() => run(picked)}>{loading ? "Finding…" : picked.length ? "Show me" : "Surprise me"}</button>
            <button className="btn btn-ghost btn-lg" disabled={loading} onClick={() => run([])} aria-label="Surprise me"><Sparkles size={18} /></button>
          </div>
        </>
      )}
      {refine && (
        <div className="rise">
          <p className="mb-3">One quick question: how much time do you have?</p>
          <div className="grid grid-cols-3 gap-2">
            {[5, 15, 30].map((t) => <button key={t} className="btn btn-ghost" onClick={() => { setBudget(t); setRefine(false); void run(picked, rejected, t); }}>≤ {t} min</button>)}
          </div>
        </div>
      )}
      {cands && !refine && (c ? (
        <div className="rise" key={c.slug}>
          <div className="card card-hi p-5">
            <div className="flex gap-4 items-start">
              <Art k={c.art} box={60} size={26} />
              <div>
                <h3 className="text-[24px] font-semibold tracking-[-0.03em] leading-tight">{c.title}</h3>
                <p className="text-sm muted mt-1">{c.activeMinutes} min active{c.passiveMinutes ? ` · ${c.passiveMinutes} min hands-off` : ""}{c.origin === "ai_generated" ? " · new idea" : ""}</p>
              </div>
            </div>
            <p className="mt-4 leading-snug">{c.why}</p>
            <button className="text-sm muted mt-2 inline-flex items-center gap-1 underline underline-offset-4" onClick={() => setWhy((w) => !w)}><Info size={14} />Why this?</button>
            {why && <p className="text-sm muted mt-2">Matches {picked.join(" + ") || "your plan"}; ranked by what you&apos;ve enjoyed before, time and pantry. Ingredients: {c.ingredients.join(", ")}.</p>}
          </div>
          {spicy && <p className="text-sm muted mt-3">{spicy}</p>}
          {note && <p className="text-xs faint mt-2">{note}</p>}
          <Link href={`/cook/${c.slug}?meal=${meal?.id}&swap=1`} className="btn btn-primary btn-lg w-full mt-5">Start cooking</Link>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button className="btn btn-ghost" onClick={accept}>I&apos;ll eat this</button>
            <button className="btn btn-ghost" onClick={reject}>Not this either</button>
          </div>
          <p className="text-xs faint text-center mt-3">{idx + 1} of {cands.length}</p>
        </div>
      ) : (
        <div>
          <p className="muted">{note ?? "Nothing else fits right now. Try fewer cravings, or use a 3-minute option."}</p>
          <button className="btn btn-ghost mt-4" onClick={() => setCands(null)}>Back</button>
        </div>
      ))}
    </Sheet>
  );
}

"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Minus, Pause, Play, Plus, Volume2, VolumeX, ThumbsUp, ThumbsDown, Meh } from "lucide-react";
import type { Recipe } from "@/lib/types";
import { getJson, post, haptic } from "@/lib/client/api";
import { Art, Ring, Sheet, Skeleton, useRewards, type RewardT } from "../ui";

/** Simple, validator-safe swaps for "I'm out of X". Anything else → find another dish. */
const SWAPS: Record<string, string> = {
  ghee: "mustard oil or cold-pressed coconut oil (same amount)",
  "mustard oil": "ghee (same amount)",
  lemon: "a pinch of amchur (dry mango powder)",
  coriander: "fresh mint, or skip it",
  curd: "thick buttermilk",
  walnuts: "4 soaked almonds",
  papaya: "1 apple or a pear",
  "brown rice": "2 jowar rotis",
  cucumber: "grated carrot",
  spinach: "methi leaves, or skip and add lauki",
  "pink salt": "regular salt",
  "rock salt": "regular salt",
};
function swapFor(name: string): string | null {
  const n = name.toLowerCase();
  const key = Object.keys(SWAPS).find((k) => n.includes(k));
  return key ? SWAPS[key] : null;
}

type TimerState = { step: number; endsAt: number; pausedLeft?: number };
const TKEY = (slug: string) => `ezf:timer:${slug}`;
const SKEY = (slug: string) => `ezf:cookstep:${slug}`;

export function CookClient({ slug }: { slug: string }) {
  const params = useSearchParams();
  const mealId = params.get("meal") ?? undefined;
  const router = useRouter();
  const rewards = useRewards();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [personal, setPersonal] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"detail" | "cook" | "done">("detail");
  const [step, setStep] = useState(0);
  const [servings, setServings] = useState(1);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [speak, setSpeak] = useState(false);
  const [missing, setMissing] = useState(false);
  const [rated, setRated] = useState(false);
  const wake = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    getJson<{ recipe: Recipe; personalMinutes: number | null }>(`/api/recipe?slug=${encodeURIComponent(slug)}${mealId ? `&meal=${mealId}` : ""}`)
      .then((r) => { setRecipe(r.recipe); setPersonal(r.personalMinutes); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load recipe"));
    try {
      const t = localStorage.getItem(TKEY(slug));
      if (t) setTimer(JSON.parse(t));
      const s = localStorage.getItem(SKEY(slug));
      if (s) { setStep(Number(s)); setMode("cook"); }
    } catch {}
  }, [slug, mealId]);

  // Background-safe timers: store the end time, render from the clock.
  useEffect(() => {
    const i = setInterval(() => setNowTs(Date.now()), 250);
    return () => clearInterval(i);
  }, []);
  const left = timer ? (timer.pausedLeft ?? Math.max(0, Math.round((timer.endsAt - nowTs) / 1000))) : null;
  const firedRef = useRef<string>("");
  useEffect(() => {
    if (timer && left === 0 && timer.pausedLeft === undefined && firedRef.current !== `${timer.step}:${timer.endsAt}`) {
      firedRef.current = `${timer.step}:${timer.endsAt}`;
      haptic([200, 100, 200]);
      chime();
      if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification("Timer done", { body: recipe?.steps[timer.step]?.timerLabel ?? "Next step", icon: "/icons/icon-192.png" });
    }
  }, [left, timer, recipe]);

  const saveTimer = (t: TimerState | null) => {
    setTimer(t);
    try { if (t) localStorage.setItem(TKEY(slug), JSON.stringify(t)); else localStorage.removeItem(TKEY(slug)); } catch {}
  };

  const say = useCallback((text: string) => {
    if (!speak || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-IN";
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }, [speak]);

  const goStep = (n: number) => {
    if (!recipe) return;
    const clamped = Math.max(0, Math.min(recipe.steps.length - 1, n));
    if (n > step) void post("/api/cooking", { kind: "cook_step_completed", recipeSlug: slug, mealId, step }, { queueable: true });
    setStep(clamped);
    try { localStorage.setItem(SKEY(slug), String(clamped)); } catch {}
    const st = recipe.steps[clamped];
    say(st.text);
    if (st.durationSeconds && (!timer || timer.step !== clamped)) saveTimer({ step: clamped, endsAt: Date.now() + st.durationSeconds * 1000 });
  };

  const start = async () => {
    setMode("cook");
    try { wake.current = await navigator.wakeLock?.request("screen"); } catch {}
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    void post("/api/cooking", { kind: "cook_started", recipeSlug: slug, mealId }, { queueable: true });
    goStep(0);
  };

  const finish = async () => {
    try { await wake.current?.release(); } catch {}
    try { localStorage.removeItem(SKEY(slug)); localStorage.removeItem(TKEY(slug)); } catch {}
    setTimer(null);
    setMode("done");
    haptic([12, 60, 24, 60, 40]);
    const r = await post<{ rewards: RewardT[] }>("/api/cooking", { kind: "cook_completed", recipeSlug: slug, mealId }, { queueable: true });
    rewards.push(r.rewards);
  };

  const leave = () => {
    if (mode === "cook") void post("/api/cooking", { kind: "cook_abandoned", recipeSlug: slug, mealId, step }, { queueable: true });
    router.push("/today");
  };

  useEffect(() => () => { void wake.current?.release().catch(() => {}); }, []);

  if (err) return <main className="app-wrap pt-10"><p className="muted">{err}</p><Link href="/today" className="btn btn-ghost mt-4">Back to Today</Link></main>;
  if (!recipe) return <main className="app-wrap pt-10 space-y-3"><Skeleton h={220} /><Skeleton h={160} /></main>;

  const scale = (q?: number) => (q === undefined ? "" : String(Math.round(q * servings * 100) / 100).replace(/^0\.5$/, "½").replace(/^0\.25$/, "¼").replace(/^0\.33$/, "⅓"));
  const st = recipe.steps[step];

  if (mode === "done") {
    return (
      <main className="min-h-dvh grid place-items-center px-6 text-center relative overflow-x-clip">
        {rewards.node}
        <div className="glow" style={{ width: 500, height: 500, top: "20%", left: "50%", marginLeft: -250 }} />
        <div className="relative">
          <div className="leaf-unfurl mx-auto w-24 h-24 rounded-full bg-white grid place-items-center"><Check size={44} color="#000" /></div>
          <h1 className="h2 mt-8">Cooked.<br /><span className="fade-tail">Enjoy it slowly.</span></h1>
          {!rated ? (
            <>
              <p className="muted mt-6">How was it?</p>
              <div className="flex justify-center gap-3 mt-3">
                {[{ v: 1, I: ThumbsUp, l: "Loved it" }, { v: 0, I: Meh, l: "Okay" }, { v: -1, I: ThumbsDown, l: "Not for me" }].map(({ v, I, l }) => (
                  <button key={v} className="btn btn-ghost !w-16 !h-16 !p-0" aria-label={l} onClick={() => { setRated(true); void post("/api/feedback", { entityType: "recipe", entityId: slug, rating: v }, { queueable: true }); }}><I size={22} /></button>
                ))}
              </div>
            </>
          ) : <p className="muted mt-6">Noted. EZ FOOD will remember.</p>}
          <Link href="/today" className="btn btn-primary btn-lg mt-10">Back to Today</Link>
        </div>
      </main>
    );
  }

  if (mode === "cook") {
    const total = recipe.steps.length;
    const timerForThis = timer && timer.step === step ? timer : null;
    return (
      <main className="min-h-dvh flex flex-col px-5 pt-[max(16px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))] max-w-[640px] mx-auto relative">
        {rewards.node}
        <div className="flex items-center justify-between">
          <button className="corner !w-11 !h-11" onClick={leave} aria-label="Leave cooking mode (progress is kept)"><ArrowLeft size={18} /></button>
          <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${total}`}>{recipe.steps.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-7 bg-white" : i < step ? "w-3 bg-white/60" : "w-3 bg-[var(--line-2)]"}`} />)}</div>
          <button className="corner !w-11 !h-11" onClick={() => setSpeak((s) => !s)} aria-label={speak ? "Stop reading aloud" : "Read steps aloud"}>{speak ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
        </div>
        <p className="eyebrow mt-8">Step {step + 1} of {total} · {recipe.titleEn}</p>
        <p className="mt-4 text-[30px] leading-[1.18] font-semibold tracking-[-0.03em] rise" key={step}>{st.text}</p>
        {st.tip && <p className="muted mt-3 text-lg">{st.tip}</p>}
        {timerForThis && left !== null && (
          <div className="mt-10 flex flex-col items-center">
            <Ring value={st.durationSeconds ? left / st.durationSeconds : 0} size={200} stroke={8} label="Timer">
              <span className="text-5xl font-bold tabular tracking-tight" aria-live="polite">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
              <span className="block text-sm muted mt-1">{st.timerLabel ?? "Timer"}</span>
            </Ring>
            <div className="flex gap-2 mt-5">
              {timerForThis.pausedLeft !== undefined ? (
                <button className="btn btn-ghost btn-sm" onClick={() => saveTimer({ step, endsAt: Date.now() + (timerForThis.pausedLeft ?? 0) * 1000 })}><Play size={15} />Resume</button>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => saveTimer({ ...timerForThis, pausedLeft: left })}><Pause size={15} />Pause</button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => saveTimer({ step, endsAt: Date.now() + (left + 60) * 1000 })}>+1 min</button>
            </div>
            {left === 0 && <p className="mt-3 font-semibold pop">Time&apos;s up.</p>}
          </div>
        )}
        {!timerForThis && st.durationSeconds && <button className="btn btn-ghost mt-8 self-start" onClick={() => saveTimer({ step, endsAt: Date.now() + st.durationSeconds! * 1000 })}><Play size={15} />Start {Math.round(st.durationSeconds / 60) || 1}-min timer</button>}
        <div className="flex-1" />
        <button className="text-sm muted underline underline-offset-4 self-center mb-4" onClick={() => setMissing(true)}>I&apos;m missing an ingredient</button>
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button className="btn btn-ghost btn-lg !px-5" disabled={step === 0} onClick={() => goStep(step - 1)} aria-label="Previous step"><ChevronLeft size={22} /></button>
          {step < total - 1 ? <button className="btn btn-primary btn-lg" onClick={() => goStep(step + 1)}>Next<ChevronRight size={20} /></button> : <button className="btn btn-primary btn-lg" onClick={finish}><Check size={20} />Done</button>}
        </div>
        <Sheet open={missing} onClose={() => setMissing(false)} title="What's missing?">
          <div className="space-y-2">
            {recipe.ingredients.map((ing, i) => {
              const sw = swapFor(ing.name);
              return (
                <div key={i} className="card p-3">
                  <p className="font-semibold">{ing.name}</p>
                  <p className="text-sm muted">{sw ? `Use ${sw}. Still plan-safe.` : ing.optional ? "Optional: just skip it." : "No safe swap for this one."}</p>
                </div>
              );
            })}
          </div>
          {mealId && <Link href={`/today`} className="btn btn-ghost w-full mt-4">Find a different dish</Link>}
        </Sheet>
      </main>
    );
  }

  // Detail
  return (
    <main className="max-w-[640px] mx-auto px-4 pt-[max(16px,env(safe-area-inset-top))] pb-[calc(110px+env(safe-area-inset-bottom))] relative overflow-x-clip">
      <div className="glow" style={{ width: 460, height: 460, top: -200, left: "50%", marginLeft: -230 }} />
      <button className="corner !w-11 !h-11 relative" onClick={() => router.back()} aria-label="Back"><ArrowLeft size={18} /></button>
      <section className="relative mt-6 rise">
        <Art k={recipe.art} box={84} size={36} />
        <h1 className="mt-6 text-[42px] leading-[0.98] font-bold tracking-[-0.05em]">{recipe.titleEn}</h1>
        {recipe.titleHi && <p className="muted mt-2 text-lg font-[family-name:var(--font-deva)]">{recipe.titleHi}</p>}
        <p className="muted mt-4 text-[17px]">{recipe.description}</p>
        <div className="flex flex-wrap gap-2 mt-5">
          <span className="tag">{recipe.activeMinutes} min active</span>
          {recipe.passiveMinutes > 0 && <span className="tag">{recipe.passiveMinutes} min hands-off</span>}
          <span className="tag">{recipe.activeMinutes + recipe.passiveMinutes} min total</span>
          <span className="tag">{recipe.addedFatTsp} tsp fat</span>
          {personal && <span className="tag !text-white !border-white/40">your usual: {personal} min</span>}
          {recipe.origin === "ai_generated" && <span className="tag">new idea · pending review</span>}
        </div>
        {recipe.leadTask && <p className="card p-4 mt-4 text-sm"><span className="eyebrow block mb-1">Needs prep</span>{recipe.leadTask.instruction}</p>}
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-[22px] font-semibold tracking-tight">Ingredients</h2>
          <div className="flex items-center gap-2 text-sm">
            <button className="corner" aria-label="Fewer servings" onClick={() => setServings((s) => Math.max(1, s - 1))}><Minus size={14} /></button>
            <span className="tabular w-16 text-center">{servings} serving{servings > 1 ? "s" : ""}</span>
            <button className="corner" aria-label="More servings" onClick={() => setServings((s) => Math.min(6, s + 1))}><Plus size={14} /></button>
          </div>
        </div>
        <ul className="mt-3 card divide-y divide-[var(--line)]">
          {recipe.ingredients.map((ing, i) => (
            <li key={i}>
              <label className="flex items-center gap-3 p-4 cursor-pointer">
                <input type="checkbox" className="w-5 h-5 accent-white" checked={checked.has(i)} onChange={() => setChecked((c) => { const n = new Set(c); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                <span className={`flex-1 ${checked.has(i) ? "line-through opacity-50" : ""}`}>{ing.name}{ing.optional ? " (optional)" : ""}</span>
                <span className="muted tabular text-sm">{scale(ing.qty)} {ing.unit ?? ""}{ing.note ? ` ${ing.note}` : ""}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-[22px] font-semibold tracking-tight">Steps</h2>
        <ol className="mt-3 space-y-2">
          {recipe.steps.map((s, i) => (
            <li key={i} className="card p-4 flex gap-3"><span className="text-sm font-bold tabular faint w-5">{String(i + 1).padStart(2, "0")}</span><span className="flex-1">{s.text}{s.durationSeconds ? <span className="muted"> · {Math.round(s.durationSeconds / 60) || "<1"} min</span> : null}</span></li>
          ))}
        </ol>
        <p className="text-sm muted mt-4">{recipe.whyGood}</p>
        {recipe.source === "estimate" && <p className="text-xs faint mt-2">Times and nutrition are ≈ estimates, pending nutritionist review.</p>}
        {recipe.nutrition && <p className="text-xs faint mt-1 tabular">≈ {recipe.nutrition.kcal} kcal · {recipe.nutrition.proteinG} g protein · {recipe.nutrition.fiberG} g fibre (estimate)</p>}
      </section>

      <div className="fixed left-0 right-0 bottom-0 p-4 pb-[max(16px,env(safe-area-inset-bottom))] bg-gradient-to-t from-black via-black/90 to-transparent">
        <button className="btn btn-primary btn-lg w-full max-w-[600px] mx-auto flex" onClick={start}>Start cooking</button>
      </div>
    </main>
  );
}

function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.25 + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.25);
      o.stop(ctx.currentTime + i * 0.25 + 0.7);
    });
  } catch {}
}

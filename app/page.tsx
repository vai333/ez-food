import Link from "next/link";
import { ArrowUpRight, Check, Flame, Shield } from "lucide-react";
import { currentUser } from "@/lib/server/session";
import { Logo } from "@/components/ui";
import { Faq, ScrollWords } from "@/components/landing/ScrollWords";
import { PLAN_RECIPES } from "@/lib/seed/plan";
import { CURATED_RECIPES } from "@/lib/seed/curated-recipes";
import { INTERVENTIONS } from "@/lib/seed/interventions";

export const dynamic = "force-dynamic";

const DISHES = [...PLAN_RECIPES, ...CURATED_RECIPES].filter((r) => !r.needsDoctorOk).map((r) => r.titleEn.replace(/\s*\(.*?\)\s*/g, " ").trim());

const FEATURES = [
  { tag: "Mornings", title: "Morning activation", sub: "Ginger water first, then the day" },
  { tag: "Cooking", title: "One step at a time", sub: "Big type, auto timers, screen stays on" },
  { tag: "Cravings", title: "Craving pivot", sub: "Sweet, crunchy, spicy: still on plan" },
  { tag: "On the go", title: "Too busy mode", sub: "Grab, assemble, or order safely" },
  { tag: "AI", title: "Learns your taste", sub: "Gemini + a safety council + hard rules" },
  { tag: "Game", title: "Quests, levels, chains", sub: "Shields protect your off days" },
];

const STEPS = [
  { n: "01", k: "Wake", t: "A calm nudge, not an alarm.", d: "Your phone's alarm, a learned-time reminder, or simply opening the app between 6 and 8 AM brings up one screen with one button: warm ginger-turmeric water. Done." },
  { n: "02", k: "Plan", t: "The day is already decided.", d: "Break-fast at 12, snack at 4, dinner at 7:30, with tonight's soak scheduled so tomorrow's chilla isn't blocked. Meetings move meals, never the 8 PM close." },
  { n: "03", k: "Cook", t: "One step, one tap.", d: "Full-screen steps, timers that survive the screen locking, read-aloud, and a fix for every missing ingredient that stays plan-safe." },
  { n: "04", k: "Adapt", t: "Cravings and chaos, handled.", d: "Don't feel like moong? Pick a craving and get one hero suggestion with a reason. No time? Three frictionless options. Adapting earns XP too." },
  { n: "05", k: "Learn", t: "It gets more you every day.", d: "Every swap and rating trains your own preference model. You can see it, edit it, pause it, or make it forget. It can never loosen your food rules." },
];

const FAQ = [
  { q: "Is this medical advice?", a: "No. EZ FOOD helps you follow the diet plan you and your doctor chose. It never diagnoses, treats, or advises on medicines or supplements, and it pauses itself and points you to a doctor if you log warning signs." },
  { q: "What exactly can't I eat?", a: "No tomato, potato, brinjal or bell pepper, and by default no chillies of any kind. Cooking fat is capped at 1 tsp of ghee, mustard oil or cold-pressed coconut oil per meal. Every recipe, swap and AI idea passes a code-level validator before you see it." },
  { q: "How does the gamification work?", a: "You earn XP for showing up: ginger water, meals on plan, swaps, prep tasks, water and honest check-ins. Three daily quests rotate, badges unlock, and your consistency chain is protected by shields you earn every 3 days, so one rough day never wipes your progress." },
  { q: "What does the AI do?", a: "When the curated library can't match a craving, Gemini proposes recipes, a second Gemini pass reviews them as a strict nutrition council, and deterministic code has the final say. Your name and contact details are never sent." },
  { q: "Does it work offline?", a: "Yes. Install it to your home screen. Today's plan, recipes and cooking mode work offline, and anything you log syncs when you're back." },
];

export default async function Landing() {
  const user = await currentUser().catch(() => null);
  const cta = user?.onboardedAt ? { href: "/today", label: "Open today" } : { href: "/onboarding", label: "Start my 7 days" };
  const recipeCount = PLAN_RECIPES.length + CURATED_RECIPES.length;
  const half = Math.ceil(DISHES.length / 2);

  return (
    <div className="relative overflow-x-clip">
      {/* Nav pill */}
      <header className="fixed top-0 inset-x-0 z-40 px-3 pt-3">
        <div className="glass rounded-full max-w-[1280px] mx-auto h-[60px] flex items-center justify-between pl-5 pr-2">
          <Logo size={30} />
          <nav className="hidden md:flex items-center gap-7 text-sm muted">
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#how" className="hover:text-white">How it works</a>
            <a href="#game" className="hover:text-white">Game</a>
            <a href="#faq" className="hover:text-white">FAQ</a>
          </nav>
          <Link href={cta.href} className="btn btn-primary btn-sm">{cta.label}</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative min-h-[100svh] flex flex-col items-center justify-center text-center px-4 pt-28 pb-16 grain">
        <div className="glow" style={{ width: 900, height: 700, top: -200, left: "50%", marginLeft: -450 }} />
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(60% 50% at 50% 35%, rgba(255,255,255,.08), transparent 70%)" }} />
        <span className="pill rise relative">AI nutrition companion · 7-day plan</span>
        <h1 className="display mt-8 relative rise" style={{ animationDelay: ".08s" }}>
          Eat properly.<br /><span className="fade-tail">Without thinking.</span>
        </h1>
        <p className="muted mt-7 max-w-xl text-[17px] md:text-lg relative rise" style={{ animationDelay: ".16s" }}>
          Your anti-inflammatory, liver-friendly plan, decided, scheduled and cooked one tap at a time. Swaps for every craving. Quests that keep you coming back.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-9 relative rise" style={{ animationDelay: ".24s" }}>
          <Link href={cta.href} className="btn btn-primary btn-lg">{cta.label}</Link>
          <a href="#how" className="btn btn-ghost btn-lg">See how it works</a>
        </div>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-12 eyebrow relative">
          <span>• {recipeCount} plan-safe recipes</span><span>• 0 chillies</span><span>• 16:8 window</span>
        </div>
        <span className="absolute left-6 bottom-8 eyebrow hidden md:flex flex-col gap-3 items-center"><span>Scroll</span><span className="w-px h-10 bg-[var(--line-2)]" /></span>
      </section>

      {/* Showcase */}
      <section className="wrap relative">
        <div className="flex justify-center"><span className="pill"><span className="dot" />Inside the app · Day 3</span></div>
        <h2 className="h2 text-center mt-6">Built like this.</h2>
        <div className="card card-xl mt-10 p-3 md:p-5 overflow-hidden">
          <div className="grid md:grid-cols-[1.1fr_1fr] gap-6 items-center rounded-[24px] border hair p-6 md:p-12 relative overflow-hidden" style={{ background: "radial-gradient(80% 80% at 80% 0%, rgba(255,255,255,.10), transparent 60%), #070708" }}>
            <div>
              <p className="eyebrow">Break-fast · in 25 min</p>
              <p className="mt-4 text-[38px] md:text-[56px] leading-[0.95] font-bold tracking-[-0.05em]">Green Moong<br /><span className="fade-tail">Dal Chilla.</span></p>
              <div className="flex flex-wrap gap-2 mt-6"><span className="tag">20 min active</span><span className="tag">≤ 1 tsp fat</span><span className="tag">soaked last night ✓</span></div>
              <div className="flex gap-2 mt-8"><span className="btn btn-primary">Start cooking</span><span className="btn btn-ghost">Don&apos;t feel like this</span></div>
            </div>
            <div className="mx-auto w-[260px] rounded-[40px] border border-[var(--line-2)] p-3 bg-black shadow-[0_40px_120px_-30px_rgba(255,255,255,.25)]">
              <div className="rounded-[30px] border hair p-4 min-h-[460px] flex flex-col gap-3" style={{ background: "radial-gradient(100% 60% at 50% 0%, rgba(255,255,255,.08), transparent), #050505" }}>
                <div className="flex justify-between items-center"><span className="text-[11px] font-bold">EZ FOOD</span><span className="flex items-center gap-1 text-[11px]"><Flame size={11} />5 <Shield size={11} />1</span></div>
                <p className="text-[24px] leading-[0.95] font-bold tracking-[-0.05em] mt-2">Good afternoon,<br /><span className="fade-tail">Vaibhav.</span></p>
                <div className="rounded-2xl border hair p-3"><p className="text-[9px] eyebrow">Level 4 · Dal Devotee</p><div className="h-1 rounded-full bg-[var(--line-2)] mt-2"><div className="h-full w-2/3 bg-white rounded-full" /></div></div>
                <div className="rounded-2xl border border-[var(--line-2)] p-3" style={{ background: "radial-gradient(120% 120% at 50% 0%, rgba(255,255,255,.12), transparent)" }}>
                  <p className="text-[9px] eyebrow">Break-fast · 12:00</p><p className="font-semibold text-sm mt-1">Moong Dal Chilla + cucumber</p><div className="mt-3 h-8 rounded-full bg-white text-black text-xs font-semibold grid place-items-center">Start cooking</div>
                </div>
                {["Eight glasses · 5/8", "Future-you favour · 0/1", "On the dot ×2 · 1/2"].map((q) => <div key={q} className="rounded-xl border hair px-3 py-2 text-[11px] flex justify-between"><span>{q}</span><span className="faint">+25</span></div>)}
              </div>
            </div>
          </div>
        </div>
        <p className="muted text-center mt-6 max-w-xl mx-auto">One primary action per screen. Built for a tired, hungry person who has five seconds.</p>
      </section>

      {/* Marquee */}
      <section className="mt-28">
        <p className="text-center muted">Cooked from <span className="text-white font-semibold">{recipeCount}</span> plan-safe recipes</p>
        <div className="mt-8 space-y-3">
          <div className="marquee"><div className="marquee-track text-[28px] md:text-[40px] font-semibold tracking-[-0.03em] text-[var(--ink-3)]">{[...DISHES.slice(0, half), ...DISHES.slice(0, half)].map((d, i) => <span key={i} className="whitespace-nowrap">{d} <span className="mx-3">•</span></span>)}</div><div className="marquee-track text-[28px] md:text-[40px] font-semibold tracking-[-0.03em] text-[var(--ink-3)]" aria-hidden>{[...DISHES.slice(0, half), ...DISHES.slice(0, half)].map((d, i) => <span key={i} className="whitespace-nowrap">{d} <span className="mx-3">•</span></span>)}</div></div>
          <div className="marquee"><div className="marquee-track rev text-[28px] md:text-[40px] font-semibold tracking-[-0.03em] text-[var(--ink-4)]">{[...DISHES.slice(half), ...DISHES.slice(half)].map((d, i) => <span key={i} className="whitespace-nowrap">{d} <span className="mx-3">•</span></span>)}</div><div className="marquee-track rev text-[28px] md:text-[40px] font-semibold tracking-[-0.03em] text-[var(--ink-4)]" aria-hidden>{[...DISHES.slice(half), ...DISHES.slice(half)].map((d, i) => <span key={i} className="whitespace-nowrap">{d} <span className="mx-3">•</span></span>)}</div></div>
        </div>
      </section>

      {/* Scroll statement + features grid */}
      <section id="features" className="wrap mt-32">
        <ScrollWords className="h2 max-w-5xl" text="Plan-perfect food, decided for you, cooked one step at a time, and rewarded every single day." />
        <p className="muted mt-6 max-w-2xl">Not a calorie counter. A companion that removes the three things that break a therapeutic diet: decision fatigue, schedule chaos and cravings.</p>
        <div className="flex gap-5 mt-6 text-sm"><Link href={cta.href} className="font-semibold">Get started →</Link><a href="#how" className="muted">How it works →</a></div>
        <div className="card card-xl mt-12 grid md:grid-cols-2 overflow-hidden">
          {FEATURES.map((f, i) => (
            <div key={f.title} className={`group p-7 md:p-9 min-h-[190px] flex flex-col border-[var(--line)] ${i % 2 === 0 ? "md:border-r" : ""} ${i < FEATURES.length - (FEATURES.length % 2 === 0 ? 2 : 1) ? "border-b" : ""} ${i === FEATURES.length - 2 ? "border-b md:border-b-0" : ""} hover:bg-white/[.025] transition-colors`}>
              <div className="flex items-start justify-between"><span className="eyebrow">{f.tag}</span><span className="corner"><ArrowUpRight size={14} /></span></div>
              <div className="flex-1" />
              <p className="text-[22px] font-semibold tracking-[-0.03em] mt-10">{f.title}</p>
              <p className="muted text-[15px] mt-1">{f.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Statement */}
      <section className="wrap mt-36 text-center">
        <h2 className="text-[34px] md:text-[52px] font-semibold tracking-[-0.04em] leading-[1.05] max-w-4xl mx-auto">You&apos;ve got <b className="text-white">meetings to run</b>, cravings to dodge, and <b className="text-white">a plan to follow.</b></h2>
        <p className="muted mt-6 max-w-2xl mx-auto">The last thing you need is to stand in the kitchen at 12:05, hungry, wondering what&apos;s allowed. EZ FOOD already knows, and it already soaked the dal.</p>
        <Link href={cta.href} className="btn btn-ghost mt-8">Let&apos;s fix that</Link>
      </section>

      {/* Two lanes */}
      <section className="wrap mt-36">
        <span className="pill"><span className="dot" />Two lanes</span>
        <h2 className="h2 mt-6">Cook it.<br /><span className="fade-tail">Or don&apos;t.</span></h2>
        <p className="muted mt-5 max-w-xl">Both lanes stay on plan. Neither is a cheat. The only thing that changes is how much time you have.</p>
        <div className="card card-xl mt-10 overflow-x-auto">
          <table className="w-full text-left min-w-[560px]">
            <thead><tr className="border-b hair"><th className="p-6 eyebrow font-semibold">Feature</th><th className="p-6"><span className="eyebrow block">Lane 1</span><span className="text-xl font-semibold">Cooking mode</span></th><th className="p-6"><span className="eyebrow block">Lane 2</span><span className="text-xl font-semibold">On the go</span></th></tr></thead>
            <tbody className="text-[15px]">
              {[["Time", "10–45 min, timers do the waiting", "≤ 3 min, or order in"], ["What you get", "The plan's own recipe, step by step", "Raw grab, quick assemble, or a safe takeout script"], ["Safety", "Validated against your rules", "Validated + copyable 'no tomato, no chilli' note"], ["Rewards", "+25 XP, on-time combo, chef bonus", "+15 XP: adapting still counts"], ["Best for", "Days with a kitchen and 20 minutes", "Back-to-back meetings and travel"]].map((r) => (
                <tr key={r[0]} className="border-b hair last:border-0"><td className="p-6 font-semibold">{r[0]}</td><td className="p-6 muted">{r[1]}</td><td className="p-6 muted">{r[2]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Game */}
      <section id="game" className="wrap mt-36">
        <h2 className="h2 max-w-4xl">Stop relying on willpower <span className="fade-tail">for things a game can do.</span></h2>
        <div className="grid md:grid-cols-3 gap-3 mt-12">
          <div className="card p-7">
            <p className="eyebrow">Levels</p>
            <p className="text-[64px] font-bold tracking-[-0.05em] leading-none mt-6">10</p>
            <p className="text-lg font-semibold mt-2">From Sprout to EZ Legend</p>
            <p className="muted text-[15px] mt-1">XP for every sip, meal, swap, soak and honest log. It never goes down.</p>
          </div>
          <div className="card p-7">
            <p className="eyebrow">Consistency chain</p>
            <div className="flex gap-1.5 mt-7">{[1, 1, 1, 0, 1, 1, 2].map((s, i) => <span key={i} className={`w-9 h-9 rounded-xl grid place-items-center border ${s === 1 ? "bg-white text-black border-white" : s === 0 ? "hair" : "border-dashed border-white/40"}`}>{s === 1 ? <Check size={14} /> : s === 0 ? <Shield size={14} /> : ""}</span>)}</div>
            <p className="text-lg font-semibold mt-5">Shields, not shame</p>
            <p className="muted text-[15px] mt-1">Earn a shield every 3 days. An off day spends one, and your chain survives.</p>
          </div>
          <div className="card p-7">
            <p className="eyebrow">Daily quests + badges</p>
            <div className="mt-6 space-y-2 text-sm">{["First sip · +20", "Future-you favour · +25", "Full house · +35"].map((q) => <div key={q} className="rounded-xl border hair px-3 py-2">{q}</div>)}</div>
            <p className="text-lg font-semibold mt-5">21 badges · hidden Lucky Bowls</p>
            <p className="muted text-[15px] mt-1">One in five logged meals hides a bonus. You never know which.</p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="wrap mt-36">
        <span className="pill"><span className="dot" />How it works</span>
        <h2 className="h2 mt-6">From wake-up to window close,<br /><span className="fade-tail">in five clear steps.</span></h2>
        <div className="mt-12 border-t hair">
          {STEPS.map((s) => (
            <div key={s.n} className="grid md:grid-cols-[120px_1fr_1.3fr] gap-3 md:gap-10 py-10 border-b hair">
              <span className="text-[44px] font-bold tracking-[-0.05em] text-[var(--ink-4)] leading-none">{s.n}</span>
              <div><p className="eyebrow">{s.k}</p><p className="text-[26px] font-semibold tracking-[-0.035em] leading-tight mt-2">{s.t}</p></div>
              <p className="muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="wrap mt-36">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[[`${recipeCount}`, "Plan-safe recipes", "Every one checked by the validator."], [`${INTERVENTIONS.length}`, "Original nudges", "Warm, never guilt. Learned per tone."], ["0", "Chillies", "Heat from pepper, ginger and mustard."], ["7", "Days", "Menu A and B, then repeat the week."]].map(([n, l, d]) => (
            <div key={l} className="card p-6 md:p-8">
              <p className="text-[48px] md:text-[64px] font-bold tracking-[-0.05em] leading-none">{n}</p>
              <p className="eyebrow mt-4">{l}</p>
              <p className="muted text-[14px] mt-2">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="wrap mt-36">
        <h2 className="h2 mb-10">Everything you need to know</h2>
        <Faq items={FAQ} />
      </section>

      {/* CTA */}
      <section className="relative mt-36 py-32 text-center px-4 overflow-hidden grain">
        <div className="glow" style={{ width: 800, height: 500, top: 0, left: "50%", marginLeft: -400 }} />
        <h2 className="h2 relative max-w-4xl mx-auto">Ready to stop<br /><span className="fade-tail">thinking about food?</span></h2>
        <p className="muted mt-6 relative max-w-lg mx-auto">Ninety seconds to set up. Your first quest is waiting: one glass of warm ginger water.</p>
        <Link href={cta.href} className="btn btn-primary btn-lg mt-10 relative">{cta.label}</Link>
      </section>

      <footer className="wrap border-t hair py-10 flex flex-col md:flex-row gap-4 md:items-center justify-between text-sm faint">
        <Logo size={24} />
        <p className="max-w-xl">EZ FOOD helps you follow the diet plan you and your doctor have chosen. It does not diagnose, treat, or replace medical advice.</p>
      </footer>
    </div>
  );
}

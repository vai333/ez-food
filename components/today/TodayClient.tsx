"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Clock, Droplet, Flame, HeartPulse, Minus, Plus, Shield, ThumbsDown, ThumbsUp, Timer, Zap, ChevronRight, WifiOff, CalendarClock } from "lucide-react";
import type { TodayPayload, TodayMeal } from "@/lib/server/today";
import { getJson, post, track, haptic, ApiError } from "@/lib/client/api";
import { fmt12 } from "@/lib/time";
import { AppShell, Art, Ring, Sheet, Skeleton, useRewards, type RewardT } from "../ui";
import { MorningTakeover } from "./MorningTakeover";
import { CravingSheet } from "./CravingSheet";
import { EmergencySheet } from "./EmergencySheet";
import { CheckinSheet, type CheckinCtx } from "./CheckinSheet";
import { RedFlagCard, UnwellSheet } from "./Safety";
import { BadgeUnlock } from "./BadgeUnlock";

type T = TodayPayload & { __offline?: boolean };

function greet(min: number) {
  if (min < 5 * 60) return "Still up";
  if (min < 12 * 60) return "Good morning";
  if (min < 17 * 60) return "Good afternoon";
  return "Good evening";
}

function rel(min: number, now: number) {
  const d = min - now;
  if (Math.abs(d) < 3) return "now";
  if (d > 0) return d < 60 ? `in ${d} min` : `in ${Math.floor(d / 60)}h ${d % 60 ? `${d % 60}m` : ""}`.trim();
  return `${-d < 60 ? `${-d} min` : `${Math.floor(-d / 60)}h`} ago`;
}

export function TodayClient() {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const params = useSearchParams();
  const rewards = useRewards();
  const [craving, setCraving] = useState<TodayMeal | null>(null);
  const [emergency, setEmergency] = useState<TodayMeal | null>(null);
  const [checkin, setCheckin] = useState<CheckinCtx | null>(null);
  const [unwell, setUnwell] = useState(false);
  const [shiftFor, setShiftFor] = useState<TodayMeal | null>(null);
  const [busyOpen, setBusyOpen] = useState(false);
  const [lineVoted, setLineVoted] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getJson<T | { onboarded: false }>("/api/today");
      if (!d.onboarded) return router.replace("/onboarding");
      setData(d as T);
      setErr(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return router.replace("/onboarding");
      setErr("Couldn't load today. Pull to retry.");
    }
  }, [router]);

  useEffect(() => {
    void load();
    track("app_open");
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const t = setInterval(load, 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(t);
    };
  }, [load]);

  const act = async (fn: () => Promise<{ rewards?: RewardT[]; __queued?: boolean } | unknown>, success?: string) => {
    try {
      const r = (await fn()) as { rewards?: RewardT[]; __queued?: boolean };
      if (r?.rewards?.length) {
        haptic([10, 40, 18]);
        rewards.push(r.rewards);
      } else if (success) rewards.push([]);
      await load();
      return r;
    } catch (e) {
      alert(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const markEaten = (m: TodayMeal) => act(() => post("/api/meals/status", { action: "eaten", mealId: m.id }, { queueable: true }));
  const skip = async (m: TodayMeal) => {
    const r = (await act(() => post("/api/meals/status", { action: "skipped", mealId: m.id }))) as { intervention?: { slug: string; text: string } } | undefined;
    setCheckin({ mealId: m.id, deviationType: "skipped", slot: m.slot, intervention: r?.intervention });
  };

  if (err && !data) return <AppShell><p className="muted">{err}</p><button className="btn btn-ghost mt-4" onClick={load}>Retry</button></AppShell>;
  if (!data) return <AppShell><div className="space-y-3"><Skeleton h={120} /><Skeleton h={200} /><Skeleton h={90} /><Skeleton h={90} /></div></AppShell>;

  const now = data.now.minutes;
  const next = data.meals.find((m) => m.id === data.nextId) ?? null;
  const g = data.game;
  const showTakeover = (data.morning === "takeover" || params.get("morning") === "1") && data.meals.find((m) => m.slot === "wake")?.status === "planned" && !data.redFlag;

  return (
    <AppShell
      right={
        <Link href="/progress" className="flex items-center gap-2 rounded-full border hair pl-1 pr-3 h-10" aria-label={`Level ${g.level.level}, ${g.chain.current} day chain`}>
          <Ring value={g.level.progress} size={32} stroke={3}><span className="text-[11px] font-bold">{g.level.level}</span></Ring>
          <span className="flex items-center gap-1 text-sm font-semibold tabular"><Flame size={15} />{g.chain.current}</span>
          {g.chain.shields > 0 && <span className="flex items-center gap-0.5 text-xs muted"><Shield size={13} />{g.chain.shields}</span>}
        </Link>
      }
    >
      {rewards.node}
      {g.unseenBadges.length > 0 && <BadgeUnlock ids={g.unseenBadges} badges={g.badges} onDone={async () => { await post("/api/game", {}); void load(); }} />}
      {showTakeover && <MorningTakeover name={data.name} meal={data.meals.find((m) => m.slot === "wake")!} meals={data.meals} prep={data.prep} autoDone={params.get("done") === "1"} onDone={async () => { const m = data.meals.find((x) => x.slot === "wake")!; await markEaten(m); router.replace("/today"); }} />}

      {data.__offline && <div className="glass rounded-full px-4 py-2 text-sm flex items-center gap-2 mb-4"><WifiOff size={15} /> Offline. Showing your saved day; taps sync later.</div>}

      {/* Hero */}
      <section className="rise">
        <span className="pill"><span className="dot" />{data.dayNo >= 1 && data.dayNo <= data.planLength ? `Week ${data.weekNo} · Day ${data.dayNo} of ${data.planLength}${data.menu ? ` · ${data.menu}` : ""}` : data.dayNo < 1 ? `Plan starts ${data.planStart}` : `Week ${data.weekNo} done · repeating`}</span>
        <h1 className="mt-4 text-[44px] leading-[0.95] font-bold tracking-[-0.05em]">
          {greet(now)},<br /><span className="fade-tail">{data.name}.</span>
        </h1>
      </section>

      {data.redFlag && <RedFlagCard onCleared={load} />}

      {data.planNext && !data.redFlag && (
        <Link href="/coach?thread=next_week" className="card card-xl card-hi group mt-6 p-5 block rise grain overflow-hidden">
          <div className="glow" style={{ width: 240, height: 240, top: -110, right: -70 }} />
          <span className="pill relative"><span className="dot" />{data.dayNo > data.planLength ? `Week ${data.weekNo} complete` : `Week ${data.weekNo} ends ${data.weekEnd}`}</span>
          <h2 className="relative mt-4 text-[28px] font-semibold tracking-[-0.035em] leading-[1.02]">Plan your next 7 days <span className="fade-tail">together.</span></h2>
          <p className="relative muted mt-2 text-[15px]">A short chat about your goal for the coming week. You confirm every change.</p>
          <span className="relative btn btn-primary w-full mt-5">Start the chat<ArrowRight size={16} /></span>
        </Link>
      )}
      {data.weekGoals.length > 0 && <p className="mt-4 text-sm muted">This week&apos;s goal: <span className="text-white">{data.weekGoals.join(" · ")}</span></p>}
      {data.kcal.planned > 0 && (
        <p className="mt-2 text-sm muted tabular">
          Planned today ≈ <span className="text-white">{data.kcal.planned.toLocaleString("en-IN")} kcal</span>
          {data.kcal.target ? <> · target {data.kcal.target.toLocaleString("en-IN")}{data.kcal.factor !== 1 ? ` · portions ×${data.kcal.factor}` : ""}</> : null}
          <span className="faint"> (estimate)</span>
        </p>
      )}

      {/* Game strip */}
      <Link href="/progress" className="card group mt-6 p-4 flex items-center gap-4 rise" style={{ animationDelay: ".05s" }}>
        <Ring value={g.level.progress} size={58} label="Level progress"><span className="text-lg font-bold leading-none">{g.level.level}</span></Ring>
        <div className="flex-1 min-w-0">
          <p className="eyebrow">Level {g.level.level} · {g.level.name}</p>
          <div className="mt-2 h-1.5 rounded-full bg-[var(--line-2)] overflow-hidden"><div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${g.level.progress * 100}%`, boxShadow: "0 0 12px #fff" }} /></div>
          <p className="text-sm muted mt-1.5 tabular">{g.xp - g.level.floor} / {g.level.next - g.level.floor} XP · +{g.todayXp} today</p>
        </div>
        <div className="text-center px-1">
          <div className="flex items-center gap-1 text-2xl font-bold tabular"><Flame size={20} />{g.chain.current}</div>
          <p className="text-[11px] faint">day chain</p>
        </div>
      </Link>

      {/* Prep tray */}
      {data.prep.length > 0 && (
        <section className="mt-4 space-y-2">
          {data.prep.slice(0, 2).map((p) => (
            <div key={p.id} className={`card p-4 flex items-start gap-3 ${p.late ? "card-hi" : ""}`}>
              <Art k={p.taskType === "sprout" || p.taskType === "rinse" ? "sprouts" : "moong"} box={42} size={18} />
              <div className="flex-1">
                <p className="eyebrow">{p.late ? "Do it now" : `Prep · ${p.dateDue === data.now.date ? `today ${p.due}` : p.due}`}</p>
                <p className="mt-1 leading-snug">{p.instruction}</p>
                {p.recovery && <p className="text-sm muted mt-1">{p.recovery}</p>}
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => act(() => post("/api/prep", { taskId: p.id }, { queueable: true }))}>Done</button>
            </div>
          ))}
        </section>
      )}

      {/* Primary next action */}
      {next && next.slot !== "wake" && (
        <section className="card card-xl card-hi mt-5 p-5 rise grain overflow-hidden" style={{ animationDelay: ".1s" }} aria-label="Next meal">
          <div className="glow" style={{ width: 260, height: 260, top: -120, right: -80 }} />
          <div className="flex items-center justify-between relative">
            <span className="pill"><span className="dot" />{next.label} · {rel(next.start, now)}</span>
            <span className="text-sm muted tabular">{fmt12(next.start)}</span>
          </div>
          <div className="mt-5 flex gap-4 items-start relative">
            <Art k={next.recipes[0]?.art} box={64} size={28} />
            <div className="min-w-0">
              <h2 className="text-[28px] font-semibold tracking-[-0.035em] leading-[1.02]">{next.recipes.map((r) => r.titleEn).join(" + ")}</h2>
              {next.recipes[0]?.titleHi && <p className="muted mt-1 font-[family-name:var(--font-deva)]">{next.recipes.map((r) => r.titleHi).filter(Boolean).join(" · ")}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4 relative">
            <span className="tag"><Timer size={12} className="mr-1" />{Math.max(...next.recipes.map((r) => r.activeMinutes))} min active</span>
            {next.recipes.some((r) => r.passiveMinutes > 0) && <span className="tag">{Math.max(...next.recipes.map((r) => r.passiveMinutes))} min hands-off</span>}
            <span className="tag">≤ {next.recipes.reduce((a, r) => a + r.addedFatTsp, 0)} tsp fat</span>
            {next.shiftMinutes !== 0 && <span className="tag">moved {next.shiftMinutes > 0 ? "+" : ""}{next.shiftMinutes} min</span>}
          </div>
          <Link href={`/cook/${next.recipes[0]?.slug}?meal=${next.id}`} className="btn btn-primary btn-lg w-full mt-6 relative">Start cooking</Link>
          <div className="grid grid-cols-2 gap-2 mt-2 relative">
            <button className="btn btn-ghost btn-sm" onClick={() => { setCraving(next); track("craving_pivot_opened", next.id); }}>Don&apos;t feel like this</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEmergency(next)}><Zap size={15} />Too busy to cook</button>
            <button className="btn btn-ghost btn-sm" onClick={() => markEaten(next)}><Check size={15} />Mark eaten</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShiftFor(next)}><Clock size={15} />Shift time</button>
          </div>
        </section>
      )}

      {data.closed && !next && (
        <section className="card card-xl card-hi mt-5 p-5 rise grain overflow-hidden" aria-label="Window closed">
          <div className="glow" style={{ width: 260, height: 260, top: -120, right: -80 }} />
          <span className="pill relative"><span className="dot" />Window closed · fasting</span>
          <h2 className="relative mt-5 text-[28px] font-semibold tracking-[-0.035em] leading-[1.02]">Water, green tea or black coffee <span className="fade-tail">until noon.</span></h2>
          {data.tomorrow && <p className="relative muted mt-3">Tomorrow&apos;s break-fast at {data.tomorrow.time}: {data.tomorrow.titles.join(" + ")}.</p>}
          <Link href="/progress?reflect=1" className="btn btn-primary btn-lg w-full mt-6 relative">Close the day · reflect</Link>
        </section>
      )}

      {data.morning === "banner" && (
        <button onClick={() => router.push("/today?morning=1")} className="card w-full text-left mt-5 p-4 flex items-center gap-3">
          <Art k="ginger" box={44} size={20} />
          <div className="flex-1"><p className="font-semibold">Warm ginger water first</p><p className="text-sm muted">Before the window opens at 12. Tap when done.</p></div>
          <ChevronRight size={18} className="muted" />
        </button>
      )}

      {!data.schedule.feasible && "reason" in data.schedule && (
        <section className="card p-4 mt-4">
          <p className="eyebrow">Tight day</p>
          <p className="mt-1">{data.schedule.reason}</p>
          <p className="text-sm muted mt-1">Pick what feels right: {(data.schedule.options ?? []).map((o) => o.label).join(" · ")}. Emergency options are one tap away on each meal.</p>
        </section>
      )}

      {/* Eating window bar */}
      <WindowBar data={data} />

      {/* Timeline */}
      <section className="mt-5 space-y-2" aria-label="Today's timeline">
        {data.meals.map((m) => (
          <MealRow key={m.id} m={m} now={now} isNext={m.id === data.nextId} overdue={data.overdueIds.includes(m.id)} onEat={() => markEaten(m)} onSkip={() => skip(m)} onEmergency={() => setEmergency(m)} onCraving={() => setCraving(m)} />
        ))}
      </section>

      {/* Water + busy */}
      <section className="grid grid-cols-[1fr_auto] gap-2 mt-4">
        <div className="card p-4 flex items-center gap-3 min-w-0">
          <Droplet size={20} className="shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold tabular leading-tight">{g.stats.waterGlasses} {g.stats.waterGlasses === 1 ? "glass" : "glasses"}</p>
            <p className="text-xs muted truncate first-letter:uppercase">{data.hydration !== "water" ? data.hydration : now < data.window.start || now >= data.window.end ? "Water · green tea · black coffee" : "Keep sipping"}</p>
          </div>
          <button className="corner shrink-0" aria-label="Remove a glass" onClick={() => act(() => post("/api/water", { delta: -1 }, { queueable: true }))}><Minus size={14} /></button>
          <button className="btn btn-primary btn-sm !px-3.5 shrink-0" aria-label="Add a glass" onClick={() => act(() => post("/api/water", { delta: 1 }, { queueable: true }))}><Plus size={16} />1</button>
        </div>
        <button className="card px-3 flex flex-col items-center justify-center text-xs muted w-[84px]" onClick={() => setBusyOpen(true)}>
          <CalendarClock size={20} className="mb-1 text-white" />Meeting?
        </button>
      </section>

      {/* Quests */}
      <section className="mt-6">
        <div className="flex items-end justify-between mb-2">
          <h2 className="text-[22px] font-semibold tracking-[-0.03em]">Today&apos;s quests</h2>
          <Link href="/progress" className="text-sm muted">All →</Link>
        </div>
        <div className="space-y-2">
          {g.quests.map((q) => (
            <div key={q.id} className={`card p-4 flex items-center gap-3 ${q.done ? "opacity-70" : ""}`}>
              <Ring value={q.value / q.goal} size={40} stroke={3.5}>{q.done ? <Check size={16} /> : <span className="text-[11px] font-bold tabular">{q.value}/{q.goal}</span>}</Ring>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold ${q.done ? "line-through decoration-1" : ""}`}>{q.title}</p>
                <p className="text-sm muted truncate">{q.hint}</p>
              </div>
              <span className="tag tabular">+{q.reward}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Line from the behaviour engine */}
      <section className="mt-8 border-t hair pt-6">
        <p className="eyebrow">{data.line.type === "quote" ? "A line for today" : "Nudge"}</p>
        <p className="text-[24px] leading-[1.15] font-semibold tracking-[-0.03em] mt-2">{data.line.text}</p>
        {data.line.attribution && <p className="text-sm muted mt-2">— {data.line.attribution}</p>}
        <div className="flex gap-2 mt-3" aria-label="Was this helpful?">
          {[1, -1].map((v) => (
            <button key={v} disabled={lineVoted === data.line.slug} className="corner !w-10 !h-10" aria-label={v > 0 ? "Helpful" : "Not helpful"} onClick={() => { setLineVoted(data.line.slug); void post("/api/feedback", { entityType: "intervention", entityId: data.line.slug, rating: v }, { queueable: true }); }}>
              {v > 0 ? <ThumbsUp size={15} /> : <ThumbsDown size={15} />}
            </button>
          ))}
        </div>
      </section>

      <button className="mt-8 w-full card p-4 flex items-center gap-3 text-left" onClick={() => setUnwell(true)}>
        <HeartPulse size={20} />
        <span className="flex-1"><span className="font-semibold">I&apos;m not feeling well</span><span className="block text-sm muted">Pauses nudges and helps you decide what to do.</span></span>
        <ChevronRight size={18} className="muted" />
      </button>

      <CravingSheet key={`c-${craving?.id ?? "none"}`} meal={craving} onClose={() => setCraving(null)} onDone={(r) => { rewards.push(r); setCraving(null); void load(); }} />
      <EmergencySheet meal={emergency} onClose={() => setEmergency(null)} onDone={(r, iv) => { rewards.push(r); const m = emergency; setEmergency(null); void load(); if (m) setCheckin({ mealId: m.id, deviationType: "emergency", slot: m.slot, intervention: iv }); }} />
      <CheckinSheet key={`k-${checkin?.mealId ?? "none"}-${checkin?.deviationType ?? ""}`} ctx={checkin} onClose={() => setCheckin(null)} onDone={(r) => { rewards.push(r); setCheckin(null); void load(); }} />
      <UnwellSheet open={unwell} onClose={() => setUnwell(false)} onDone={() => { setUnwell(false); void load(); }} inFast={now < data.window.start} />
      <ShiftSheet meal={shiftFor} onClose={() => setShiftFor(null)} onDone={() => { setShiftFor(null); void load(); }} />
      <BusySheet open={busyOpen} now={now} onClose={() => setBusyOpen(false)} onDone={() => { setBusyOpen(false); void load(); }} busy={data.busy} />
    </AppShell>
  );
}

function WindowBar({ data }: { data: T }) {
  const startH = 6 * 60, endH = 22 * 60;
  const pos = (m: number) => `${((Math.min(Math.max(m, startH), endH) - startH) / (endH - startH)) * 100}%`;
  const now = data.now.minutes;
  const open = now >= data.window.start && now < data.window.end;
  return (
    <section className="card p-4 mt-5" aria-label="Eating window">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Eating window · 16:8</p>
        <p className="text-sm font-semibold">{open ? `Open · closes ${fmt12(data.window.end)}` : now < data.window.start ? `Opens ${fmt12(data.window.start)}` : "Closed · water & tea"}</p>
      </div>
      <div className="relative mt-4 h-9">
        <div className="absolute inset-x-0 top-4 h-[3px] rounded-full bg-[var(--line-2)]" />
        <div className="absolute top-[13px] h-[9px] rounded-full bg-white/90" style={{ left: pos(data.window.start), width: `calc(${pos(data.window.end)} - ${pos(data.window.start)})`, boxShadow: "0 0 16px rgba(255,255,255,.4)" }} />
        {data.meals.map((m) => (
          <span key={m.id} className={`absolute top-[9px] -ml-[8px] w-[16px] h-[16px] rounded-full border-2 ${["eaten", "swapped", "emergency"].includes(m.status) ? "bg-white border-white" : "bg-black border-white"}`} style={{ left: pos(m.start) }} title={`${m.label} ${m.startLabel}`} />
        ))}
        {data.busy.map((b) => <span key={b.id} className="absolute top-[26px] h-[4px] rounded-full bg-[var(--ink-3)]" style={{ left: pos(b.start), width: `calc(${pos(b.end)} - ${pos(b.start)})` }} title={b.label} />)}
        <span className="absolute -top-0.5 bottom-0 w-px bg-white" style={{ left: pos(now) }} aria-label="Now"><span className="absolute -top-1 -left-[3px] w-[7px] h-[7px] rounded-full bg-white" /></span>
      </div>
      <div className="flex justify-between text-[11px] faint tabular mt-1"><span>6 AM</span><span>12 PM</span><span>4 PM</span><span>8 PM</span><span>10 PM</span></div>
    </section>
  );
}

function MealRow({ m, now, isNext, overdue, onEat, onSkip, onEmergency, onCraving }: { m: TodayMeal; now: number; isNext: boolean; overdue: boolean; onEat: () => void; onSkip: () => void; onEmergency: () => void; onCraving: () => void }) {
  const done = ["eaten", "swapped", "emergency"].includes(m.status);
  const [open, setOpen] = useState(false);
  const statusText: Record<string, string> = { eaten: "Eaten as planned", swapped: "Swapped, still on plan", emergency: "Handled on the go", skipped: "Skipped (that's data, not a verdict)", missed: "Passed", prepping: "Cooking…", planned: rel(m.start, now) };
  const title = m.actualRecipe && m.status === "swapped" ? "Plan-safe swap" : m.recipes.map((r) => r.titleEn).join(" + ");
  return (
    <div className={`card p-4 ${isNext ? "border-[var(--line-2)]" : ""} ${overdue ? "card-hi" : ""}`}>
      <button className="w-full flex items-center gap-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`grid place-items-center w-9 h-9 rounded-full border shrink-0 ${done ? "bg-white text-black border-white" : "hair"}`}>{done ? <Check size={16} /> : <span className="text-[11px] font-bold tabular">{m.startLabel.slice(0, 5)}</span>}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] eyebrow">{m.label} · {fmt12(m.start)}</p>
          <p className="font-semibold truncate">{title}</p>
          <p className="text-sm muted">{overdue ? "45 min past. Want a 3-minute option?" : statusText[m.status] ?? m.status}</p>
        </div>
        <ChevronRight size={18} className={`muted transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 pt-3 border-t hair flex flex-wrap gap-2">
          {m.recipes.map((r) => <Link key={r.slug} href={`/cook/${r.slug}?meal=${m.id}`} className="btn btn-ghost btn-sm">{r.titleEn.split("(")[0].trim()} →</Link>)}
          {!done && m.slot !== "wake" && <>
            <button className="btn btn-primary btn-sm" onClick={onEat}>Mark eaten</button>
            <button className="btn btn-ghost btn-sm" onClick={onCraving}>Swap</button>
            <button className="btn btn-ghost btn-sm" onClick={onEmergency}>Too busy</button>
            <button className="btn btn-ghost btn-sm" onClick={onSkip}>Skip</button>
          </>}
          {!done && m.slot === "wake" && m.status === "planned" && <button className="btn btn-primary btn-sm" onClick={onEat}>Done</button>}
        </div>
      )}
      {overdue && !open && (
        <div className="flex gap-2 mt-3">
          <button className="btn btn-primary btn-sm flex-1" onClick={onEmergency}><Zap size={14} />Quick option</button>
          <button className="btn btn-ghost btn-sm" onClick={onEat}>I ate it</button>
        </div>
      )}
    </div>
  );
}

function ShiftSheet({ meal, onClose, onDone }: { meal: TodayMeal | null; onClose: () => void; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const opts = [-30, -15, 15, 30, 45, 60];
  return (
    <Sheet open={!!meal} onClose={onClose} title={`Shift ${meal?.label ?? ""}`}>
      <p className="muted mb-4">Currently {meal ? fmt12(meal.start) : ""}. Later meals re-flow to keep 2.5–5 h gaps and the 8 PM close.</p>
      <div className="grid grid-cols-3 gap-2">
        {opts.map((o) => (
          <button key={o} className="btn btn-ghost" onClick={async () => { try { await post("/api/meals/status", { action: "shift", mealId: meal!.id, minutes: o }); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't shift"); } }}>
            {o > 0 ? "+" : ""}{o} min
          </button>
        ))}
      </div>
      {err && <p className="text-sm mt-3" style={{ color: "var(--warn)" }}>{err}</p>}
    </Sheet>
  );
}

function BusySheet({ open, now, onClose, onDone, busy }: { open: boolean; now: number; onClose: () => void; onDone: () => void; busy: { id: string; start: number; end: number; label: string }[] }) {
  const [start, setStart] = useState("13:00");
  const [end, setEnd] = useState("14:00");
  const [res, setRes] = useState<string | null>(null);
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const add = async (a: number, b: number, label: string) => {
    const r = await post<{ feasible: boolean; options: { label: string }[] }>("/api/busy", { start: a, end: b, label });
    setRes(r.feasible ? "Done. Meals re-planned around it." : `Tight: ${r.options.map((o) => o.label).join(" · ") || "use a no-cook option"}`);
    onDone();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Busy block">
      <button className="btn btn-primary w-full" onClick={() => add(now, now + 30, "Meeting running late")}>Meeting running late +30</button>
      <div className="grid grid-cols-2 gap-2 mt-4">
        <label className="text-sm muted">From<input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1" /></label>
        <label className="text-sm muted">To<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1" /></label>
      </div>
      <button className="btn btn-ghost w-full mt-3" onClick={() => add(toMin(start), toMin(end), "Busy")}>Add block</button>
      {res && <p className="text-sm muted mt-3">{res}</p>}
      {busy.length > 0 && (
        <div className="mt-4 space-y-2">
          {busy.map((b) => (
            <div key={b.id} className="flex items-center justify-between text-sm border hair rounded-2xl px-3 py-2">
              <span>{b.label} · {fmt12(b.start)}–{fmt12(b.end)}</span>
              <button className="muted underline" onClick={async () => { await post("/api/busy", { id: b.id }, { method: "DELETE" }); onDone(); }}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}


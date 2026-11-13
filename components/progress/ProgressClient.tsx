"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Flame, Lock, Shield, Brain } from "lucide-react";
import type { GameSummary } from "@/lib/server/game";
import { getJson, post } from "@/lib/client/api";
import { LEVEL_NAMES, xpForLevel } from "@/lib/game/engine";
import { AppShell, BADGE_ICON, CornerLink, Ring, Sheet, Skeleton, useRewards, type RewardT } from "../ui";
import { FaceScale } from "../today/CheckinSheet";

export function ProgressClient() {
  const [g, setG] = useState<GameSummary | null>(null);
  const params = useSearchParams();
  const [reflect, setReflect] = useState(params.get("reflect") === "1");
  const rewards = useRewards();
  const load = () => getJson<GameSummary>("/api/game").then(setG).catch(() => {});
  useEffect(() => { void load(); }, []);

  if (!g) return <AppShell><div className="space-y-3"><Skeleton h={200} /><Skeleton h={120} /><Skeleton h={300} /></div></AppShell>;
  const earned = g.badges.filter((b) => b.earned).length;

  return (
    <AppShell>
      {rewards.node}
      <span className="pill"><span className="dot" />Progress</span>
      <section className="card card-xl card-hi grain overflow-hidden mt-5 p-6 text-center">
        <div className="glow" style={{ width: 300, height: 300, top: -120, left: "50%", marginLeft: -150 }} />
        <div className="relative flex justify-center"><Ring value={g.level.progress} size={150} stroke={7} label="Level progress"><span className="block text-[52px] font-bold leading-none tracking-tight">{g.level.level}</span><span className="text-xs muted">level</span></Ring></div>
        <h1 className="relative h3 mt-5">{g.level.name}</h1>
        <p className="relative muted tabular mt-1">{g.xp.toLocaleString()} XP · {g.level.next - g.xp} to {LEVEL_NAMES[g.level.level] ?? "the next level"}</p>
        <div className="relative grid grid-cols-3 gap-2 mt-6">
          <Stat n={g.chain.current} l="day chain" icon={<Flame size={16} />} />
          <Stat n={g.chain.shields} l={`shields · max ${g.chain.maxShields}`} icon={<Shield size={16} />} />
          <Stat n={g.daysOnPlan} l="days on plan" />
        </div>
      </section>

      <section className="mt-6 card p-5">
        <div className="flex items-center justify-between"><h2 className="text-[22px] font-semibold tracking-tight">Consistency chain</h2><span className="text-sm muted">best {g.chain.best}</span></div>
        <p className="text-sm muted mt-1">A day counts when 3 of 4 slots are on plan; swaps and on-the-go options count too. Every 3 counted days earns a shield that protects the chain on an off day.{g.chain.nextShieldIn > 0 ? ` Next shield in ${g.chain.nextShieldIn} day${g.chain.nextShieldIn > 1 ? "s" : ""}.` : ""}</p>
        <div className="flex flex-wrap gap-1.5 mt-4">
          {g.chain.days.map((d) => (
            <span key={d.date} title={`${d.date}: ${d.state.replace("_", " ")}`} className={`w-9 h-9 rounded-xl grid place-items-center text-[10px] font-semibold border ${d.state === "counted" ? "bg-white text-black border-white" : d.state === "shielded" ? "hair" : d.state === "pending" ? "border-dashed border-white/40" : "hair opacity-40"}`}>
              {d.state === "counted" ? <Check size={14} /> : d.state === "shielded" ? <Shield size={14} /> : d.date.slice(8)}
            </span>
          ))}
        </div>
        {g.chain.days.some((d) => d.state === "fresh_start") && <p className="text-xs faint mt-3">Faded days were fresh starts. Your best chain is kept forever.</p>}
      </section>

      <section className="mt-6">
        <h2 className="text-[22px] font-semibold tracking-tight mb-2">Today&apos;s quests</h2>
        <div className="space-y-2">
          {g.quests.map((q) => (
            <div key={q.id} className="card p-4 flex items-center gap-3">
              <Ring value={q.value / q.goal} size={44} stroke={3.5}>{q.done ? <Check size={16} /> : <span className="text-[11px] font-bold tabular">{q.value}/{q.goal}</span>}</Ring>
              <div className="flex-1"><p className="font-semibold">{q.title}</p><p className="text-sm muted">{q.hint}</p></div>
              <span className="tag tabular">{q.done ? "done" : `+${q.reward}`}</span>
            </div>
          ))}
          <button className="card w-full p-4 text-left flex items-center gap-3" onClick={() => setReflect(true)}>
            <span className="grid place-items-center w-11 h-11 rounded-full border hair">🌙</span>
            <span className="flex-1"><span className="font-semibold block">Nightly reflection</span><span className="text-sm muted">Five taps after the window closes · +10 XP</span></span>
            <span className="tag">{g.stats.reflection ? "done" : "open"}</span>
          </button>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-end justify-between mb-3"><h2 className="text-[22px] font-semibold tracking-tight">Badges</h2><span className="text-sm muted tabular">{earned} / {g.badges.length}</span></div>
        <div className="grid grid-cols-3 gap-2">
          {g.badges.map((b) => {
            const Icon = BADGE_ICON[b.icon] ?? BADGE_ICON.star;
            return (
              <div key={b.id} className={`card p-3 text-center ${b.earned ? "" : "opacity-45"}`} title={b.detail}>
                <span className={`mx-auto grid place-items-center w-12 h-12 rounded-full ${b.earned ? "bg-white text-black" : "border hair"}`}>{b.earned ? <Icon size={22} strokeWidth={1.6} /> : <Lock size={16} />}</span>
                <p className="text-[13px] font-semibold mt-2 leading-tight">{b.title}</p>
                <p className="text-[11px] faint mt-0.5 leading-snug">{b.detail}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8 card p-5">
        <h2 className="text-[22px] font-semibold tracking-tight">Levels</h2>
        <div className="mt-3 space-y-1.5">
          {LEVEL_NAMES.map((n, i) => (
            <div key={n} className={`flex items-center justify-between text-sm ${i + 1 <= g.level.level ? "" : "faint"}`}>
              <span><span className="tabular w-6 inline-block">{i + 1}</span>{n}</span><span className="tabular">{xpForLevel(i + 1).toLocaleString()} XP</span>
            </div>
          ))}
        </div>
        <p className="text-xs faint mt-3">XP never goes down. Adapted meals and honest logs earn XP too.</p>
      </section>

      <Link href="/learned" className="card group mt-6 p-5 flex items-center gap-4">
        <Brain size={24} strokeWidth={1.6} />
        <span className="flex-1"><span className="font-semibold block">What EZ FOOD has learned</span><span className="text-sm muted">Insights, preferences, and your controls.</span></span>
        <span className="corner">→</span>
      </Link>
      <div className="mt-4"><CornerLink href="/api/export" label="Export my data">Doctor-friendly export (JSON)</CornerLink></div>

      <ReflectionSheet open={reflect} onClose={() => setReflect(false)} onDone={(r) => { rewards.push(r); setReflect(false); void load(); }} />
    </AppShell>
  );
}

function Stat({ n, l, icon }: { n: number; l: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border hair p-3">
      <div className="flex items-center justify-center gap-1 text-2xl font-bold tabular">{icon}{n}</div>
      <p className="text-[11px] faint mt-0.5">{l}</p>
    </div>
  );
}

function ReflectionSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (r: RewardT[]) => void }) {
  const [energy, setEnergy] = useState<number>();
  const [joint, setJoint] = useState<number>();
  const [dig, setDig] = useState<number>();
  const [hard, setHard] = useState("");
  const [win, setWin] = useState("");
  const submit = async () => {
    const r = await post<{ rewards: RewardT[] }>("/api/checkins", { kind: "reflection", energy, jointComfort: joint, digestion: dig, reasonCodes: [], symptomFlags: [], answers: { hardest: hard, win } }, { queueable: true });
    onDone(r.rewards ?? []);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Close the day">
      <div className="space-y-2">
        <FaceScale label="Energy" value={energy} onChange={setEnergy} />
        <FaceScale label="Joints" value={joint} onChange={setJoint} />
        <FaceScale label="Digestion" value={dig} onChange={setDig} />
      </div>
      <label className="block text-sm muted mt-4">Hardest moment<input className="mt-1" value={hard} onChange={(e) => setHard(e.target.value)} maxLength={200} /></label>
      <label className="block text-sm muted mt-3">One win<input className="mt-1" value={win} onChange={(e) => setWin(e.target.value)} maxLength={200} /></label>
      <p className="text-xs faint mt-3">Patterns, not proof. Shown only to you.</p>
      <button className="btn btn-primary w-full mt-4" onClick={submit}>Save reflection</button>
    </Sheet>
  );
}

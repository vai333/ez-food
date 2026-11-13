"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getJson } from "@/lib/client/api";
import { AppShell, Skeleton } from "@/components/ui";

type WeekT = { weekNo: number; start: string; end: string; goals: string[]; summary: string | null; days: { dayNo: number; date: string; menu: string; slots: { slot: string; label: string; time: string; status: string; recipes: { slug: string; title: string }[] }[] }[] };
type Week = { today: string; current: number; weeks: WeekT[]; prep: { id: string; instruction: string; dateDue: string; due: string; status: string; taskType: string }[] };

export default function PlanPage() {
  const [data, setData] = useState<Week | null>(null);
  const [weekNo, setWeekNo] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    getJson<Week>("/api/plan").then((x) => {
      setData(x);
      setWeekNo(x.current);
      const cw = x.weeks.find((k) => k.weekNo === x.current);
      setOpen(cw?.days.find((d) => d.date === x.today)?.dayNo ?? 1);
    }).catch(() => {});
  }, []);
  const wk = data?.weeks.find((k) => k.weekNo === weekNo) ?? null;
  const w = data && wk ? { ...wk, today: data.today, prep: data.prep } : null;
  const done = (s: string) => ["eaten", "swapped", "emergency"].includes(s);
  return (
    <AppShell>
      <span className="pill"><span className="dot" />7-day plan</span>
      <h1 className="mt-4 text-[44px] leading-[0.95] font-bold tracking-[-0.05em]">Anti-inflammatory<br /><span className="fade-tail">& liver-friendly.</span></h1>
      <p className="muted mt-3">Window 12:00–20:00. No nightshades, no chillies, ≤ 1 tsp fat per meal. Week 1 is your original plan; later weeks are planned with the coach.</p>
      {data && (
        <div className="flex gap-1.5 mt-5 overflow-x-auto no-scrollbar" role="tablist" aria-label="Weeks">
          {data.weeks.map((k) => <button key={k.weekNo} role="tab" aria-selected={k.weekNo === weekNo} className="chip !min-h-9 !text-sm shrink-0" aria-pressed={k.weekNo === weekNo} onClick={() => { setWeekNo(k.weekNo); setOpen(1); }}>Week {k.weekNo}{k.weekNo === data.current ? " · now" : ""}</button>)}
          <Link href="/coach?thread=next_week" className="chip !min-h-9 !text-sm shrink-0">+ Plan next week</Link>
        </div>
      )}
      {wk && (wk.goals.length > 0 || wk.summary) && <p className="text-sm muted mt-3">{wk.goals.length > 0 && <>Goal: <span className="text-white">{wk.goals.join(" · ")}</span>. </>}{wk.summary}</p>}
      {!w ? <div className="space-y-2 mt-6"><Skeleton h={70} /><Skeleton h={70} /><Skeleton h={70} /></div> : (
        <>
          <div className="grid grid-cols-7 gap-1.5 mt-6" role="tablist" aria-label="Days">
            {w.days.map((d) => {
              const n = d.slots.filter((s) => done(s.status)).length;
              const isToday = d.date === w.today;
              return (
                <button key={d.dayNo} role="tab" aria-selected={open === d.dayNo} onClick={() => setOpen(d.dayNo)} className={`rounded-2xl border py-3 flex flex-col items-center gap-1 transition-all ${open === d.dayNo ? "bg-white text-black border-white" : "hair"} ${isToday && open !== d.dayNo ? "border-white/50" : ""}`}>
                  <span className="text-[10px] font-semibold tracking-widest opacity-70">D{d.dayNo}</span>
                  <span className="text-lg font-bold leading-none">{/^Menu [AB]$/.test(d.menu) ? d.menu.slice(5) : d.dayNo}</span>
                  <span className="flex gap-0.5">{[0, 1, 2, 3].map((i) => <span key={i} className={`w-1 h-1 rounded-full ${i < n ? (open === d.dayNo ? "bg-black" : "bg-white") : "bg-current opacity-25"}`} />)}</span>
                </button>
              );
            })}
          </div>
          {w.days.filter((d) => d.dayNo === open).map((d) => (
            <section key={d.dayNo} className="mt-5 space-y-2 rise">
              <p className="eyebrow">Day {d.dayNo} · {new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })} · {d.menu}</p>
              {d.slots.map((s) => (
                <div key={s.slot} className="card p-4 flex gap-3">
                  <span className="tabular text-sm font-semibold w-12 pt-0.5">{s.time}</span>
                  <div className="flex-1 min-w-0">
                    <p className="eyebrow">{s.label}</p>
                    <div className="flex flex-wrap gap-x-3">{s.recipes.map((r) => <Link key={r.slug} href={`/cook/${r.slug}`} className="font-semibold hover:underline underline-offset-4">{r.title}</Link>)}</div>
                  </div>
                  {done(s.status) && <span className="grid place-items-center w-7 h-7 rounded-full bg-white text-black"><Check size={14} /></span>}
                </div>
              ))}
            </section>
          ))}
          <section className="mt-10">
            <h2 className="text-[26px] font-semibold tracking-[-0.035em]">Prep pipeline</h2>
            <p className="muted text-sm mt-1">Soaks and sprouts EZ FOOD schedules for you, so tomorrow&apos;s break-fast is never blocked.</p>
            <div className="mt-3 space-y-2">
              {w.prep.length === 0 && <p className="faint text-sm">Nothing queued yet.</p>}
              {w.prep.map((p) => (
                <div key={p.id} className={`card p-4 flex gap-3 ${p.status === "done" ? "opacity-50" : ""}`}>
                  <span className="text-sm tabular font-semibold w-24 shrink-0">{p.dateDue.slice(5)} · {p.due}</span>
                  <span className="flex-1 text-[15px]">{p.instruction}</span>
                  {p.status === "done" && <Check size={16} />}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}

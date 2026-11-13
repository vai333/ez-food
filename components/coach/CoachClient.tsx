"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, Check, CircleSlash, RotateCcw, ShieldAlert } from "lucide-react";
import { getJson, post } from "@/lib/client/api";
import { fmt12, hm } from "@/lib/time";

type Proposal = { id: string; kind: string; status: "pending" | "confirmed" | "rejected" | "blocked" | "superseded"; blockedReason: string | null; preview: Preview };
type Preview = {
  title: string;
  reason?: string;
  summary?: string;
  goals?: string[];
  recipes?: { title: string; changes: { before: string; after: string }[] }[];
  replacements?: { week: number; dayNo: number; slot: string; from: string; to: string }[];
  changes?: { dayNo: number; date: string; from: string; to: string }[];
  days?: { dayNo: number; date: string; label?: string; slots: { slot: string; time: string; titles: string[] }[] }[];
  repairs?: string[];
  more?: number;
  hiddenRecipes?: number;
  week?: number;
};
type Msg = { id: string; role: "user" | "assistant"; content: string; quickReplies: string[]; proposals: Proposal[] };
type ThreadT = { thread: "coach" | "next_week"; ai: boolean; messages: Msg[] };

const SLOT: Record<string, string> = { breakfast: "Break-fast", snack: "Snack", dinner: "Dinner", wake: "Wake" };

export function CoachClient() {
  const params = useSearchParams();
  const router = useRouter();
  const thread = params.get("thread") === "next_week" ? "next_week" : "coach";
  const [data, setData] = useState<ThreadT | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getJson<ThreadT>(`/api/coach?thread=${thread}`).then(setData).catch((e) => setErr(e.message));
  }, [thread]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [data?.messages.length, busy]);

  const send = async (t: string) => {
    const msg = t.trim();
    if (!msg || busy) return;
    setText("");
    setBusy(true);
    setErr(null);
    setData((d) => (d ? { ...d, messages: [...d.messages, { id: `tmp-${Date.now()}`, role: "user", content: msg, quickReplies: [], proposals: [] }] } : d));
    try {
      setData(await post<ThreadT>("/api/coach", { op: "send", thread, text: msg }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send");
    } finally {
      setBusy(false);
    }
  };
  const decide = async (id: string, action: "confirm" | "reject") => {
    setBusy(true);
    try {
      setData(await post<ThreadT>("/api/coach/proposal", { id, action }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const last = data?.messages[data.messages.length - 1];
  const confirmedWeek = data?.messages.some((m) => m.proposals.some((p) => p.kind === "week_plan" && p.status === "confirmed"));

  return (
    <div className="min-h-dvh relative overflow-x-clip">
      <div className="glow" style={{ width: 520, height: 520, top: -260, left: "50%", marginLeft: -260 }} />
      <header className="sticky top-0 z-30 pt-[max(10px,env(safe-area-inset-top))] px-3">
        <div className="glass rounded-full max-w-[640px] mx-auto h-[56px] flex items-center justify-between pl-2 pr-2">
          <button className="corner !w-10 !h-10" aria-label="Back" onClick={() => router.back()}><ArrowLeft size={16} /></button>
          <div className="text-center">
            <p className="text-sm font-semibold leading-tight">{thread === "next_week" ? "Plan your next 7 days" : "EZ coach"}</p>
            <p className="text-[11px] faint">{data?.ai === false ? "basic mode · AI key missing" : "Gemini · every change needs your OK"}</p>
          </div>
          <button className="corner !w-10 !h-10" aria-label="Start over" onClick={async () => { if (confirm("Clear this conversation? Confirmed changes stay.")) setData(await post<ThreadT>("/api/coach", { op: "reset", thread })); }}><RotateCcw size={15} /></button>
        </div>
      </header>

      <main className="max-w-[640px] mx-auto px-4 pt-6 pb-[calc(150px+env(safe-area-inset-bottom))] relative">
        {!data && !err && <p className="muted">Loading…</p>}
        {err && <p className="text-sm" style={{ color: "var(--warn)" }}>{err}</p>}
        <div className="space-y-5">
          {data?.messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end rise">
                <p className="max-w-[85%] rounded-[22px] rounded-br-md bg-[#f5f5f7] text-black px-4 py-2.5 text-[16px] leading-snug">{m.content}</p>
              </div>
            ) : (
              <div key={m.id} className="rise">
                <p className="text-[19px] leading-[1.35] tracking-[-0.015em] whitespace-pre-wrap">{m.content}</p>
                {m.proposals.map((p) => <ProposalCard key={p.id} p={p} busy={busy} onDecide={decide} />)}
              </div>
            ),
          )}
          {busy && <div className="flex gap-1.5 py-2" aria-label="Coach is typing">{[0, 1, 2].map((i) => <span key={i} className="w-2 h-2 rounded-full bg-white/70 animate-pulse" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>}
          {confirmedWeek && thread === "next_week" && (
            <Link href="/plan" className="card group p-4 flex items-center gap-3"><span className="flex-1 font-semibold">See next week in Plan</span><span className="corner"><ArrowRight size={14} /></span></Link>
          )}
          <div ref={end} />
        </div>
      </main>

      <div className="fixed left-0 right-0 bottom-0 z-40 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-6 bg-gradient-to-t from-black via-black/95 to-transparent">
        <div className="max-w-[640px] mx-auto">
          {last?.role === "assistant" && last.quickReplies.length > 0 && !busy && (
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-2">
              {last.quickReplies.map((q) => <button key={q} className="chip !min-h-9 !text-sm shrink-0" onClick={() => send(q)}>{q}</button>)}
            </div>
          )}
          <form className="glass rounded-full flex items-center gap-2 pl-5 pr-1.5 h-[56px]" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <input aria-label="Message" className="!bg-transparent !border-0 !p-0 flex-1 focus:outline-none" placeholder={thread === "next_week" ? "Your goal, busy days, likes…" : "e.g. I'd like to drink alkaline water"} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
            <button type="submit" className="btn btn-primary !w-11 !h-11 !min-h-0 !p-0" disabled={busy || !text.trim()} aria-label="Send"><ArrowUp size={18} /></button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ProposalCard({ p, busy, onDecide }: { p: Proposal; busy: boolean; onDecide: (id: string, a: "confirm" | "reject") => void }) {
  const v = p.preview;
  const state = { confirmed: "Confirmed", rejected: "Not applied", superseded: "Replaced by a newer draft", blocked: "Can't apply", pending: "Needs your OK" }[p.status];
  return (
    <section className={`card card-hi mt-4 p-4 ${p.status === "superseded" || p.status === "rejected" ? "opacity-50" : ""}`} aria-label={v.title}>
      <div className="flex items-center justify-between gap-2">
        <span className="pill !py-1 !text-[10px]"><span className="dot" />{state}</span>
        {p.status === "confirmed" && <Check size={16} />}
        {p.status === "blocked" && <ShieldAlert size={16} />}
      </div>
      <h3 className="text-[20px] font-semibold tracking-[-0.025em] leading-tight mt-3">{v.title}</h3>
      {(v.summary || v.reason) && <p className="muted text-[15px] mt-1">{v.summary || v.reason}</p>}
      {v.goals && v.goals.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{v.goals.map((g) => <span key={g} className="tag">{g}</span>)}</div>}

      {v.recipes && (
        <ul className="mt-3 space-y-2">
          {v.recipes.map((r) => (
            <li key={r.title} className="rounded-2xl border hair p-3">
              <p className="text-sm font-semibold">{r.title}</p>
              {r.changes.map((c, i) => <p key={i} className="text-[13px] mt-1"><span className="faint line-through">{c.before}</span> <span className="muted">→</span> {c.after}</p>)}
            </li>
          ))}
          {!!v.more && <li className="text-xs faint">+ {v.more} more recipes</li>}
        </ul>
      )}
      {v.replacements && (
        <ul className="mt-3 space-y-1.5 text-[14px]">
          {v.replacements.length === 0 && <li className="muted">No meals in your plan need changing.</li>}
          {v.replacements.map((r, i) => <li key={i}><span className="faint">Week {r.week} · Day {r.dayNo} · {SLOT[r.slot]}:</span> {r.from} → <b>{r.to}</b></li>)}
          {!!v.more && <li className="text-xs faint">+ {v.more} more</li>}
          {!!v.hiddenRecipes && <li className="text-xs faint">{v.hiddenRecipes} recipes that need it will be hidden from swaps.</li>}
        </ul>
      )}
      {v.changes && (
        <ul className="mt-3 space-y-1 text-[14px]">{v.changes.map((c) => <li key={c.dayNo}><span className="faint">Day {c.dayNo}:</span> {c.from} → <b>{c.to}</b></li>)}</ul>
      )}
      {v.days && (
        <div className="mt-3 space-y-1.5">
          {v.days.map((d) => (
            <details key={d.dayNo} className="rounded-2xl border hair px-3 py-2" open={d.dayNo === 1}>
              <summary className="cursor-pointer text-sm font-semibold flex justify-between"><span>Day {d.dayNo}{d.label ? ` · ${d.label}` : ""}</span><span className="faint font-normal">{new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span></summary>
              <ul className="mt-1.5 space-y-1 text-[13px]">{d.slots.map((s) => <li key={s.slot}><span className="faint tabular">{fmt12(hm(s.time))} {SLOT[s.slot]}:</span> {s.titles.join(" + ")}</li>)}</ul>
            </details>
          ))}
          {v.repairs && v.repairs.length > 0 && <p className="text-xs faint mt-2">Safety check adjusted: {v.repairs.join(" ")}</p>}
        </div>
      )}
      {p.status === "blocked" && <p className="text-sm mt-3 flex gap-2" style={{ color: "var(--warn)" }}><CircleSlash size={15} className="shrink-0 mt-0.5" />{p.blockedReason}</p>}
      {p.status === "pending" && (
        <div className="grid grid-cols-[1fr_auto] gap-2 mt-4">
          <button className="btn btn-primary" disabled={busy} onClick={() => onDecide(p.id, "confirm")}><Check size={16} />Confirm</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => onDecide(p.id, "reject")}>Not now</button>
        </div>
      )}
    </section>
  );
}

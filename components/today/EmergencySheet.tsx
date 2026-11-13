"use client";
import { useEffect, useState } from "react";
import { Apple, Copy, ExternalLink, Package, ShoppingBag } from "lucide-react";
import type { TodayMeal } from "@/lib/server/today";
import { post } from "@/lib/client/api";
import { Sheet, type RewardT } from "../ui";

type Opt = { slug: string; title: string; activeMinutes: number; art?: string; steps: string[] };
type Res = { outsideWindow: boolean; message?: string; grab: Opt[]; assemble: Opt[]; order: null | { note: string; safest: string[]; avoid: string[]; links: { label: string; url: string }[]; honesty: string } };

/** Flow D: three frictionless options. Calm tone, no penalty. */
export function EmergencySheet({ meal, onClose, onDone }: { meal: TodayMeal | null; onClose: () => void; onDone: (r: RewardT[], intervention?: { slug: string; text: string }) => void }) {
  const [res, setRes] = useState<Res | null>(null);
  const [tab, setTab] = useState<"grab" | "assemble" | "order" | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!meal) return;
    setRes(null);
    setTab(null);
    void post<Res>("/api/emergency/options", { mealId: meal.id }).then(setRes).catch(() => setRes({ outsideWindow: false, grab: [], assemble: [], order: null }));
  }, [meal]);

  const choose = async (choice: "grab" | "assemble" | "order", slug?: string) => {
    const r = await post<{ rewards: RewardT[]; intervention?: { slug: string; text: string } }>("/api/emergency/choose", { mealId: meal!.id, choice, slug }, { queueable: true });
    onDone(r.rewards ?? [], r.intervention);
  };

  return (
    <Sheet open={!!meal} onClose={onClose} title="On the go" tall>
      {!res && <p className="muted">Finding the fastest safe options…</p>}
      {res?.outsideWindow && <p className="muted">{res.message}</p>}
      {res && !res.outsideWindow && !tab && (
        <>
          <p className="muted mb-4">Your cooking plan is paused, not deleted. Pick one:</p>
          <div className="space-y-2">
            {[
              { k: "grab" as const, icon: Apple, t: "Grab a raw snack", d: res.grab[0]?.title ?? "Fruit + nuts" },
              { k: "assemble" as const, icon: Package, t: "Quick assemble · ≤ 3 min", d: res.assemble[0]?.title ?? "Curd + seeds" },
              { k: "order" as const, icon: ShoppingBag, t: "Healthy takeout", d: "What to order + a copyable note" },
            ].map((o) => (
              <button key={o.k} className="card group w-full p-5 flex items-center gap-4 text-left" onClick={() => setTab(o.k)}>
                <span className="grid place-items-center w-12 h-12 rounded-full border hair"><o.icon size={22} strokeWidth={1.6} /></span>
                <span className="flex-1"><span className="block text-lg font-semibold tracking-tight">{o.t}</span><span className="text-sm muted">{o.d}</span></span>
                <span className="corner">→</span>
              </button>
            ))}
          </div>
        </>
      )}
      {res && tab && tab !== "order" && (
        <div className="space-y-2 rise">
          {(tab === "grab" ? res.grab : res.assemble).map((o) => (
            <div key={o.slug} className="card p-4">
              <p className="font-semibold">{o.title}</p>
              <ol className="text-sm muted mt-1 list-decimal pl-5 space-y-0.5">{o.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              <button className="btn btn-primary btn-sm mt-3" onClick={() => choose(tab, o.slug)}>I&apos;ll have this</button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setTab(null)}>← Back</button>
        </div>
      )}
      {res?.order && tab === "order" && (
        <div className="rise">
          <p className="eyebrow">Paste this in the order note</p>
          <div className="card p-4 mt-2 flex items-start gap-3">
            <p className="flex-1">{res.order.note}</p>
            <button className="corner" aria-label="Copy note" onClick={async () => { await navigator.clipboard?.writeText(res.order!.note); setCopied(true); }}><Copy size={14} /></button>
          </div>
          {copied && <p className="text-xs faint mt-1">Copied.</p>}
          <p className="eyebrow mt-5">Safest picks</p>
          <ul className="mt-2 space-y-1">{res.order.safest.map((s) => <li key={s} className="text-[15px]">· {s}</li>)}</ul>
          <p className="eyebrow mt-5">Skip</p>
          <ul className="mt-2 space-y-1 muted">{res.order.avoid.map((s) => <li key={s} className="text-[15px]">· {s}</li>)}</ul>
          <div className="flex flex-wrap gap-2 mt-5">{res.order.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">{l.label}<ExternalLink size={13} /></a>)}</div>
          <p className="text-xs faint mt-3">{res.order.honesty}</p>
          <button className="btn btn-primary w-full mt-5" onClick={() => choose("order")}>I ordered something safe</button>
          <button className="btn btn-ghost btn-sm mt-2" onClick={() => setTab(null)}>← Back</button>
        </div>
      )}
    </Sheet>
  );
}

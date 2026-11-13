"use client";
import { useEffect, useState } from "react";
import { Pin, Trash2 } from "lucide-react";
import { getJson, post } from "@/lib/client/api";
import { AppShell, Skeleton } from "@/components/ui";

type Data = { paused: boolean; consent: boolean; insights: { id: string; summary: string; evidenceCount: number; confidence: number; suggestedAdjustment: string | null; status: string; userEditedText: string | null }[]; memories: { id: string; text: string; kind: string; pinned: boolean; weight: number }[]; prefs: { key: string; mean: number; n: number }[] };

export default function Learned() {
  const [d, setD] = useState<Data | null>(null);
  const load = () => getJson<Data>("/api/learned").then(setD).catch(() => {});
  useEffect(() => { void load(); }, []);
  const op = async (body: object) => { await post("/api/learned", body); await load(); };
  if (!d) return <AppShell><Skeleton h={300} /></AppShell>;
  const recipes = d.prefs.filter((p) => p.key.startsWith("recipe:")).slice(0, 8);
  return (
    <AppShell>
      <span className="pill"><span className="dot" />Learning loop</span>
      <h1 className="mt-4 text-[40px] leading-[0.95] font-bold tracking-[-0.05em]">What EZ FOOD<br /><span className="fade-tail">has learned.</span></h1>
      <p className="muted mt-3">Every tap, swap and rating nudges these. Learning only reorders plan-safe options. It can never relax your food rules.</p>
      {(!d.consent || d.paused) && <p className="card p-4 mt-4 text-sm">Learning is {d.paused ? "paused" : "off"}. Turn it on in Settings.</p>}

      <h2 className="eyebrow mt-8 mb-2">Insights this week</h2>
      <div className="space-y-2">
        {d.insights.length === 0 && <p className="faint text-sm">Not enough data yet. Give it a few days.</p>}
        {d.insights.map((i) => (
          <div key={i.id} className={`card p-4 ${i.status === "dismissed" ? "opacity-50" : ""}`}>
            <p className="font-semibold leading-snug">{i.userEditedText ?? i.summary}</p>
            <p className="text-xs faint mt-1">Based on {i.evidenceCount} log{i.evidenceCount === 1 ? "" : "s"} · {Math.round(i.confidence * 100)}% confident</p>
            {i.suggestedAdjustment && <p className="text-sm muted mt-2">Suggestion: {i.suggestedAdjustment}</p>}
            <div className="flex gap-2 mt-3">
              <button className="chip !min-h-9 !text-sm" aria-pressed={i.status === "agreed"} onClick={() => op({ op: "insight", id: i.id, action: "agree" })}>Agree</button>
              <button className="chip !min-h-9 !text-sm" onClick={() => op({ op: "insight", id: i.id, action: "disagree" })}>Not me</button>
              <button className="chip !min-h-9 !text-sm" onClick={() => { const t = prompt("Edit this insight", i.userEditedText ?? i.summary); if (t) void op({ op: "insight", id: i.id, action: "edit", text: t }); }}>Edit</button>
            </div>
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={() => op({ op: "rebuild" })}>Refresh insights</button>
      </div>

      <h2 className="eyebrow mt-8 mb-2">Memories</h2>
      <div className="space-y-2">
        {d.memories.length === 0 && <p className="faint text-sm">Nothing yet. Swaps and ratings become memories.</p>}
        {d.memories.map((m) => (
          <div key={m.id} className="card p-3 flex items-center gap-2">
            <span className="flex-1 text-[15px]">{m.text}</span>
            <button className="corner" aria-label="Pin" aria-pressed={m.pinned} onClick={() => op({ op: "memory", id: m.id, action: "pin" })}><Pin size={13} /></button>
            <button className="corner" aria-label="Delete memory" onClick={() => op({ op: "memory", id: m.id, action: "delete" })}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>

      {recipes.length > 0 && (
        <>
          <h2 className="eyebrow mt-8 mb-2">Favourite signals</h2>
          <div className="card p-4 space-y-2">
            {recipes.map((r) => (
              <div key={r.key} className="text-sm">
                <div className="flex justify-between"><span>{r.key.slice(7).replace(/-/g, " ")}</span><span className="faint tabular">{r.n} signal{r.n === 1 ? "" : "s"}</span></div>
                <div className="h-1 bg-[var(--line-2)] rounded-full mt-1"><div className="h-full bg-white rounded-full" style={{ width: `${r.mean * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </>
      )}

      <button className="btn btn-ghost w-full mt-8" onClick={() => { if (confirm("Forget everything EZ FOOD has learned about your preferences? Your meal logs and XP stay.")) void op({ op: "forget" }); }}>Forget what you&apos;ve learned</button>
    </AppShell>
  );
}

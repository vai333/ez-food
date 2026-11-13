"use client";
import { useEffect, useState } from "react";
import { getJson, post } from "@/lib/client/api";
import type { Recipe } from "@/lib/types";

type D = { pending: { id: string; slug: string; recipe: Recipe; validator: { ok: boolean; violations: { humanMessage: string }[] } }[]; usage: { purpose: string; n: number; cache: number; fallback: number; tokens: number }[] };

/** Admin review: AI-generated recipes stay pending until a human approves (desktop-first, minimal). */
export default function Admin() {
  const [d, setD] = useState<D | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => getJson<D>("/api/admin/review").then(setD).catch((e) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  return (
    <main className="wrap py-10">
      <h1 className="h2">Review queue</h1>
      {err && <p className="muted mt-4">{err}</p>}
      {d && (
        <>
          <h2 className="eyebrow mt-8">AI usage · 30 days</h2>
          <table className="mt-2 text-sm w-full max-w-2xl">
            <thead><tr className="text-left faint"><th>Purpose</th><th>Calls</th><th>Cache hits</th><th>Fallbacks</th><th>Tokens</th></tr></thead>
            <tbody>{d.usage.map((u) => <tr key={u.purpose} className="border-t hair"><td className="py-1.5">{u.purpose}</td><td>{u.n}</td><td>{u.cache}</td><td>{u.fallback}</td><td>{u.tokens}</td></tr>)}</tbody>
          </table>
          <h2 className="eyebrow mt-8">Pending recipes ({d.pending.length})</h2>
          <div className="grid md:grid-cols-2 gap-3 mt-3">
            {d.pending.map((p) => (
              <div key={p.id} className="card p-5">
                <p className="font-semibold text-lg">{p.recipe.titleEn}</p>
                <p className="text-sm muted">{p.recipe.description}</p>
                <p className="text-sm mt-2">{p.recipe.ingredients.map((i) => i.name).join(", ")}</p>
                <ol className="text-sm muted list-decimal pl-5 mt-2">{p.recipe.steps.map((s, i) => <li key={i}>{s.text}</li>)}</ol>
                <p className="text-xs mt-2">{p.validator.ok ? "Validator: pass" : `Validator: ${p.validator.violations.map((v) => v.humanMessage).join("; ")}`} · fat {p.recipe.addedFatTsp} tsp</p>
                <div className="flex gap-2 mt-3">
                  <button className="btn btn-primary btn-sm" disabled={!p.validator.ok} onClick={async () => { await post("/api/admin/review", { id: p.id, action: "approve" }); void load(); }}>Approve</button>
                  <button className="btn btn-ghost btn-sm" onClick={async () => { await post("/api/admin/review", { id: p.id, action: "reject" }); void load(); }}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

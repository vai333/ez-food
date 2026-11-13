"use client";
import { useState } from "react";
import { Phone } from "lucide-react";
import { post } from "@/lib/client/api";
import { URGENT_CARE_SIGNS } from "@/lib/safety/redflags";
import { Sheet } from "../ui";

export function RedFlagCard({ onCleared }: { onCleared: () => void }) {
  const [more, setMore] = useState(false);
  return (
    <section className="card card-hi p-5 mt-5" role="alert">
      <p className="eyebrow">Plan paused for today</p>
      <h2 className="text-2xl font-semibold tracking-tight mt-1">Please check in with a doctor.</h2>
      <p className="muted mt-2">Something you logged can need medical attention. Nudges are off and nothing here is urgent. It&apos;s okay to eat now if you need to.</p>
      <div className="flex flex-wrap gap-2 mt-4">
        <a href="tel:112" className="btn btn-primary btn-sm"><Phone size={14} />Emergency 112</a>
        <button className="btn btn-ghost btn-sm" onClick={() => setMore((m) => !m)}>When to seek urgent care</button>
        <button className="btn btn-ghost btn-sm" onClick={async () => { await post("/api/safety", { op: "clear_red_flag" }); onCleared(); }}>I&apos;ve been seen / I&apos;m okay</button>
      </div>
      {more && <ul className="mt-4 text-sm muted space-y-1">{URGENT_CARE_SIGNS.map((s) => <li key={s}>· {s}</li>)}</ul>}
    </section>
  );
}

const SYMPTOMS = [
  { k: "dizzy", label: "Dizzy / light-headed" }, { k: "weak", label: "Weak" }, { k: "shaky", label: "Shaky or sweaty" }, { k: "nausea", label: "Nausea" },
  { k: "joint", label: "Joint stiffness" }, { k: "fatigue", label: "Very tired" }, { k: "pain", label: "Belly pain" }, { k: "other", label: "Something else" },
];

/** "I'm not feeling well": safety valve during the fast + red-flag screen. Never invents a protocol. */
export function UnwellSheet({ open, onClose, onDone, inFast }: { open: boolean; onClose: () => void; onDone: () => void; inFast: boolean }) {
  const [sel, setSel] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [res, setRes] = useState<null | { redFlag: boolean; fastingValve: boolean }>(null);
  const [eatNow, setEatNow] = useState<null | { title: string; note: string }>(null);
  const submit = async () => {
    const words = sel.map((k) => SYMPTOMS.find((s) => s.k === k)?.label).join(", ");
    const r = await post<{ redFlag: boolean; fastingValve: boolean }>("/api/checkins", { kind: "unwell", reasonCodes: ["felt_unwell"], reasonText: `${words}. ${text}`.trim(), symptomFlags: sel });
    setRes({ redFlag: r.redFlag, fastingValve: r.fastingValve || (inFast && sel.some((k) => ["dizzy", "weak", "shaky"].includes(k))) });
  };
  return (
    <Sheet open={open} onClose={() => { setRes(null); setSel([]); setText(""); setEatNow(null); onClose(); }} title="Not feeling well">
      {!res ? (
        <>
          <div className="flex flex-wrap gap-1.5">{SYMPTOMS.map((s) => <button key={s.k} className="chip !min-h-9 !text-sm" aria-pressed={sel.includes(s.k)} onClick={() => setSel((x) => (x.includes(s.k) ? x.filter((y) => y !== s.k) : [...x, s.k]))}>{s.label}</button>)}</div>
          <textarea className="mt-4" rows={2} placeholder="Describe it in your words (optional)" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary w-full mt-4" onClick={submit}>Continue</button>
        </>
      ) : (
        <div className="space-y-3 rise">
          {res.redFlag && <div className="card card-hi p-4"><p className="font-semibold">Please contact a doctor.</p><p className="text-sm muted mt-1">Nudges are paused for 24 h. If it feels severe, call 112.</p></div>}
          {res.fastingValve && !eatNow && (
            <div className="card p-4">
              <p className="font-semibold">It&apos;s okay to eat now.</p>
              <p className="text-sm muted mt-1">Break the fast early with your plan&apos;s own snack. No guilt, no penalty.</p>
              <button className="btn btn-primary btn-sm mt-3" onClick={async () => setEatNow((await post<{ suggestion: { title: string; note: string } }>("/api/safety", { op: "early_break" })).suggestion)}>Show me what to eat</button>
            </div>
          )}
          {eatNow && <div className="card p-4"><p className="font-semibold">{eatNow.title}</p><p className="text-sm muted mt-1">{eatNow.note}</p></div>}
          {!res.redFlag && !res.fastingValve && <p className="muted">Thanks for telling me. Go gently today; it&apos;s logged so you can share it with your doctor.</p>}
          <button className="btn btn-ghost w-full" onClick={() => { setRes(null); setSel([]); setText(""); setEatNow(null); onDone(); }}>Close</button>
        </div>
      )}
    </Sheet>
  );
}

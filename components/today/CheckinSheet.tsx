"use client";
import { useState } from "react";
import { post } from "@/lib/client/api";
import { detectRedFlags } from "@/lib/safety/redflags";
import type { DeviationType, MealSlot, ReasonCode } from "@/lib/types";
import { Sheet, type RewardT } from "../ui";

export type CheckinCtx = { mealId: string; deviationType: DeviationType; slot: MealSlot; intervention?: { slug: string; text: string } };

const REASONS: { code: ReasonCode; label: string }[] = [
  { code: "no_time", label: "No time" }, { code: "meeting_ran_late", label: "Meeting ran late" }, { code: "not_hungry", label: "Not hungry" }, { code: "craving_something_else", label: "Craving else" },
  { code: "didnt_like_recipe", label: "Didn't like it" }, { code: "no_ingredients", label: "No ingredients" }, { code: "too_tired_to_cook", label: "Too tired" }, { code: "social_event", label: "Social plan" },
  { code: "travel", label: "Travel" }, { code: "stress_emotional", label: "Stress" }, { code: "forgot", label: "Forgot" }, { code: "felt_unwell", label: "Felt unwell" }, { code: "other", label: "Other" },
];
const FACES = ["😣", "🙁", "😐", "🙂", "😄"];

export function FaceScale({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm muted w-20">{label}</span>
      <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
        {FACES.map((f, i) => (
          <button key={i} role="radio" aria-checked={value === i + 1} aria-label={`${label} ${i + 1} of 5`} className={`w-10 h-10 rounded-full border text-lg grid place-items-center transition-all ${value === i + 1 ? "bg-white border-white scale-110" : "hair opacity-70"}`} onClick={() => onChange(i + 1)}>{f}</button>
        ))}
      </div>
    </div>
  );
}

/** 10-second check-in: chips + faces + optional note. Always skippable. Logging never blocks anything. */
export function CheckinSheet({ ctx, onClose, onDone }: { ctx: CheckinCtx | null; onClose: () => void; onDone: (r: RewardT[]) => void }) {
  const [reasons, setReasons] = useState<ReasonCode[]>([]);
  const [mood, setMood] = useState<number>();
  const [hunger, setHunger] = useState<number>();
  const [energy, setEnergy] = useState<number>();
  const [text, setText] = useState("");
  const [helped, setHelped] = useState<boolean>();
  const [flag, setFlag] = useState(false);

  const submit = async () => {
    const r = await post<{ rewards: RewardT[]; redFlag: boolean }>("/api/checkins", { mealId: ctx!.mealId, kind: "deviation", deviationType: ctx!.deviationType, reasonCodes: reasons, reasonText: text || undefined, mood, hunger, energy, symptomFlags: [], interventionShown: ctx!.intervention?.slug, interventionHelped: helped }, { queueable: true });
    if (r.redFlag) { setFlag(true); return; }
    onDone(r.rewards ?? []);
  };

  return (
    <Sheet open={!!ctx} onClose={onClose} title="Quick check-in">
      {ctx?.intervention && (
        <div className="card p-4 mb-4">
          <p className="text-lg font-semibold leading-snug tracking-tight">{ctx.intervention.text}</p>
          <div className="flex gap-2 mt-3 text-sm">
            <span className="muted self-center">Helpful?</span>
            <button className="chip !min-h-9" aria-pressed={helped === true} onClick={() => setHelped(true)}>Yes</button>
            <button className="chip !min-h-9" aria-pressed={helped === false} onClick={() => setHelped(false)}>Not really</button>
          </div>
        </div>
      )}
      {flag ? (
        <div className="card card-hi p-4">
          <p className="font-semibold">That sounds like something to check with a doctor.</p>
          <p className="text-sm muted mt-1">Nudges are paused. Please contact your doctor, or urgent care if it feels severe.</p>
          <button className="btn btn-primary btn-sm mt-3" onClick={() => onDone([])}>Okay</button>
        </div>
      ) : (
        <>
          <p className="text-sm muted mb-2">What got in the way? (optional)</p>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => <button key={r.code} className="chip !min-h-9 !text-sm" aria-pressed={reasons.includes(r.code)} onClick={() => setReasons((x) => (x.includes(r.code) ? x.filter((y) => y !== r.code) : [...x, r.code]))}>{r.label}</button>)}
          </div>
          <div className="space-y-2 mt-5">
            <FaceScale label="Mood" value={mood} onChange={setMood} />
            <FaceScale label="Hunger" value={hunger} onChange={setHunger} />
            <FaceScale label="Energy" value={energy} onChange={setEnergy} />
          </div>
          <textarea className="mt-4" rows={2} placeholder="Anything else? (optional)" value={text} onChange={(e) => { setText(e.target.value); if (detectRedFlags(e.target.value).flagged) setFlag(false); }} maxLength={1000} />
          {detectRedFlags(text).flagged && <p className="text-sm mt-2" style={{ color: "var(--warn)" }}>That may need a doctor. Submitting will pause nudges and show what to do.</p>}
          <div className="grid grid-cols-[1fr_auto] gap-2 mt-5">
            <button className="btn btn-primary" onClick={submit}>Save · +5 XP</button>
            <button className="btn btn-ghost" onClick={onClose}>Skip</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

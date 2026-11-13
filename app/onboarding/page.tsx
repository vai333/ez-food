"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { post } from "@/lib/client/api";
import { Logo } from "@/components/ui";
import { addDays, toIst } from "@/lib/time";

/** ≤ 90 seconds, one question per card. Disclaimer acknowledgement is required; everything else has a safe default. */
export default function Onboarding() {
  const router = useRouter();
  const ist = useMemo(() => toIst(), []);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [start, setStart] = useState(ist.minutes >= 20 * 60 ? addDays(ist.date, 1) : ist.date);
  const [ack, setAck] = useState(false);
  const [clin, setClin] = useState(false);
  const [strict, setStrict] = useState(true);
  const [consent, setConsent] = useState(true);
  const [wake, setWake] = useState("06:45");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isIos, setIsIos] = useState(false);
  useEffect(() => setIsIos(/iphone|ipad/i.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone), []);

  const cards = [
    {
      eyebrow: "Welcome",
      title: <>Eat the plan.<br /><span className="fade-tail">Without thinking.</span></>,
      body: (
        <>
          <p className="muted text-lg">EZ FOOD turns your 7-day anti-inflammatory, liver-friendly plan into one tap at a time, and makes sticking to it feel like a game.</p>
          <label className="block mt-8 text-sm muted">What should I call you?<input autoFocus className="mt-2 !text-lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first name" maxLength={40} /></label>
        </>
      ),
      ok: name.trim().length > 0,
    },
    {
      eyebrow: "Your plan",
      title: <>7 days.<br /><span className="fade-tail">16:8 window.</span></>,
      body: (
        <>
          <div className="card p-4 space-y-1.5 text-[15px]">
            <p><b>On waking</b> · warm ginger-turmeric water</p>
            <p><b>12:00</b> · moong chilla or sprout salad</p>
            <p><b>16:00</b> · papaya or buttermilk + 4 walnuts</p>
            <p><b>19:30</b> · moong dal + lauki, or palak khichdi</p>
          </div>
          <label className="block mt-5 text-sm muted">Start date<input type="date" className="mt-2" value={start} min={ist.date} onChange={(e) => setStart(e.target.value)} /></label>
          {ist.minutes >= 20 * 60 && <p className="text-sm faint mt-2">It&apos;s past 8 PM, so tomorrow is the default.</p>}
        </>
      ),
      ok: !!start,
    },
    {
      eyebrow: "Safety first",
      title: <>A diet tool,<br /><span className="fade-tail">not a doctor.</span></>,
      body: (
        <div className="space-y-3">
          <label className="card p-4 flex gap-3 items-start cursor-pointer"><input type="checkbox" className="mt-1 w-5 h-5 accent-white" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>EZ FOOD helps me follow the diet plan my doctor and I chose. It does not diagnose, treat, or replace medical advice. <b>(required)</b></span></label>
          <label className="card p-4 flex gap-3 items-start cursor-pointer"><input type="checkbox" className="mt-1 w-5 h-5 accent-white" checked={clin} onChange={(e) => setClin(e.target.checked)} /><span>My doctor knows I&apos;m following this plan, including the 16:8 fasting window.</span></label>
          {!clin && <p className="text-sm muted px-1">Fasting isn&apos;t right for everyone (for example on glucose-lowering medicine, in pregnancy, or with a history of eating disorders). Please confirm with your doctor. I won&apos;t nag.</p>}
          <label className="card p-4 flex gap-3 items-start cursor-pointer"><input type="checkbox" className="mt-1 w-5 h-5 accent-white" checked={strict} onChange={(e) => setStrict(e.target.checked)} /><span>Avoid <b>all</b> chillies, not just the nightshades named in the plan. <span className="muted">Recommended: heat will come from black pepper, ginger and mustard seeds.</span></span></label>
        </div>
      ),
      ok: ack,
    },
    {
      eyebrow: "Mornings",
      title: <>When do you<br /><span className="fade-tail">usually wake?</span></>,
      body: (
        <>
          <input type="time" className="!text-2xl !py-4" value={wake} min="06:00" max="08:00" onChange={(e) => setWake(e.target.value)} />
          <p className="muted mt-3">I&apos;ll remind you about ginger water then, and learn your real wake time over the week. Opening the app between 6 and 8 AM shows the morning screen. You can also connect your phone&apos;s alarm in Settings → Wake detection.</p>
          {isIos && <p className="card p-4 mt-4 text-sm">On iPhone, reminders need EZ FOOD on your Home Screen: tap Share → <b>Add to Home Screen</b>, then open it from there.</p>}
        </>
      ),
      ok: /^\d{2}:\d{2}$/.test(wake),
    },
    {
      eyebrow: "Learning",
      title: <>Your feedback<br /><span className="fade-tail">trains your agent.</span></>,
      body: (
        <>
          <label className="card p-4 flex gap-3 items-start cursor-pointer"><input type="checkbox" className="mt-1 w-5 h-5 accent-white" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>Use my taps, skips and ratings to personalise suggestions. <span className="muted">You can pause it or make it forget everything at any time.</span></span></label>
          <p className="text-sm muted mt-4">Your health data stays in your account. No ads, no third-party analytics. AI requests never include your name or contact details.</p>
        </>
      ),
      ok: true,
    },
  ];
  const c = cards[step];

  const finish = async () => {
    setBusy(true);
    setErr(null);
    try {
      await post("/api/onboarding", { name, startDate: start, disclaimerAck: true, clinicianAware: clin, strictCapsicum: strict, consentPersonalisation: consent, wakeTime: wake });
      router.replace("/today");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh relative overflow-hidden">
      <div className="glow" style={{ width: 560, height: 560, top: -260, left: "50%", marginLeft: -280 }} />
      <div className="relative max-w-[520px] mx-auto px-5 pt-[max(20px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] min-h-dvh flex flex-col">
        <div className="flex items-center justify-between">
          {step > 0 ? <button className="corner !w-10 !h-10" aria-label="Back" onClick={() => setStep(step - 1)}><ArrowLeft size={16} /></button> : <Logo size={28} />}
          <div className="flex gap-1.5">{cards.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-7 bg-white" : i < step ? "w-3 bg-white/60" : "w-3 bg-[var(--line-2)]"}`} />)}</div>
        </div>
        <div key={step} className="rise mt-10 flex-1">
          <span className="pill"><span className="dot" />{c.eyebrow}</span>
          <h1 className="mt-5 text-[48px] leading-[0.92] font-bold tracking-[-0.055em]">{c.title}</h1>
          <div className="mt-7">{c.body}</div>
        </div>
        {err && <p className="text-sm mb-2" style={{ color: "var(--warn)" }}>{err}</p>}
        <button className="btn btn-primary btn-lg w-full mt-8" disabled={!c.ok || busy} onClick={() => (step < cards.length - 1 ? setStep(step + 1) : finish())}>
          {step < cards.length - 1 ? "Continue" : busy ? "Setting up…" : "Start my plan"}
        </button>
      </div>
    </main>
  );
}

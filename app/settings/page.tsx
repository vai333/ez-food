"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, Copy, Download, Smartphone, Trash2 } from "lucide-react";
import { getJson, post } from "@/lib/client/api";
import { AppShell, Skeleton } from "@/components/ui";

type Profile = { name: string; strictCapsicum: boolean; consentPersonalisation: boolean; learningPaused: boolean; clinicianAware: boolean; dinnerCarb: "rice" | "roti"; learnedWakeTime: string; eatingWindow: [string, string]; notifPrefs: Record<string, boolean>; hasWakeHook: boolean; wakeToken?: string };
type Personal = { id: string; kind: string; from?: string; to?: string; ingredient?: string; name?: string; text?: string };
type PantryItem = { key: string; label: string; group: string; inStock: boolean };

const NOTIF: [string, string][] = [["wake_activation", "Morning ginger water"], ["meal_prep", "Time to start cooking"], ["prep_task", "Soak / sprout reminders"], ["hydration", "Water breaks"], ["window_closing", "Window closing"], ["nightly_reflection", "Nightly reflection"]];

function urlBase64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function SettingsPage() {
  const [p, setP] = useState<Profile | null>(null);
  const [pantry, setPantry] = useState<PantryItem[] | null>(null);
  const [personal, setPersonal] = useState<Personal[] | null>(null);
  const [push, setPush] = useState<string>("");
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    getJson<Profile>("/api/settings").then(setP).catch(() => {});
    getJson<PantryItem[]>("/api/pantry").then(setPantry).catch(() => {});
    getJson<Personal[]>("/api/personalisations").then(setPersonal).catch(() => setPersonal([]));
    if ("Notification" in window) setPush(Notification.permission);
  }, []);
  const save = async (patch: Partial<Profile> & { rotateWakeToken?: boolean }) => {
    const r = await post<Profile>("/api/settings", patch);
    setP(r);
    if (r.wakeToken) setToken(r.wakeToken);
  };

  const enablePush = async () => {
    try {
      const perm = await Notification.requestPermission();
      setPush(perm);
      if (perm !== "granted") return;
      const { publicKey } = await getJson<{ publicKey: string | null }>("/api/push");
      const reg = await navigator.serviceWorker.ready;
      if (!publicKey) return alert("Push keys aren't configured on the server yet (VAPID). In-app reminders still work.");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const j = sub.toJSON();
      await post("/api/push", { op: "subscribe", endpoint: j.endpoint, keys: j.keys });
      new Notification("EZ FOOD reminders are on", { body: "I'll remind you when it's time for ginger water.", icon: "/icons/icon-192.png" });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't enable notifications");
    }
  };

  if (!p) return <AppShell><Skeleton h={300} /></AppShell>;
  const hook = token && typeof window !== "undefined" ? `${location.origin}/api/hooks/wake?token=${token}` : null;

  return (
    <AppShell>
      <span className="pill"><span className="dot" />Settings</span>
      <h1 className="mt-4 text-[44px] leading-[0.95] font-bold tracking-[-0.05em]">Your rules.<br /><span className="fade-tail">Your data.</span></h1>

      <Section title="Reminders">
        <button className="btn btn-primary w-full" onClick={enablePush} disabled={push === "granted"}><Bell size={16} />{push === "granted" ? "Notifications on" : "Turn on reminders"}</button>
        {push === "denied" && <p className="text-sm muted mt-2">Notifications are blocked in your browser settings. In-app banners still work.</p>}
        <div className="divide-y divide-[var(--line)] mt-2">{NOTIF.map(([k, l]) => <Toggle key={k} label={l} on={p.notifPrefs[k] !== false} onChange={(v) => save({ notifPrefs: { ...p.notifPrefs, [k]: v } })} />)}</div>
        <p className="text-xs faint mt-2">Max 6 a day. Quiet hours 22:00–06:00 (except your wake reminder). Everything pauses if you report feeling unwell.</p>
      </Section>

      <Section title="Wake detection">
        <p className="text-sm muted">Browsers can&apos;t see when you unlock your phone, so EZ FOOD uses three layers: your phone&apos;s alarm automation (best), a reminder at your learned wake time ({p.learnedWakeTime}), and the morning screen when you open the app between 6 and 8 AM.</p>
        <button className="btn btn-ghost btn-sm mt-3" onClick={() => save({ rotateWakeToken: true })}>{p.hasWakeHook ? "Generate a new link" : "Create my wake link"}</button>
        {hook && (
          <div className="card p-3 mt-3 text-xs break-all flex gap-2 items-start"><span className="flex-1">{hook}</span><button className="corner shrink-0" aria-label="Copy wake link" onClick={() => navigator.clipboard?.writeText(hook)}><Copy size={13} /></button></div>
        )}
        {hook && <p className="text-xs faint mt-1">Shown once. Keep it private.</p>}
        <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">iPhone (Shortcuts)</summary><ol className="muted list-decimal pl-5 mt-2 space-y-1"><li>Shortcuts → Automation → New → <b>Alarm</b> → &quot;Is Stopped&quot; (Wake-Up alarm).</li><li>Add action <b>Get Contents of URL</b>, paste your link, Method: POST.</li><li>Turn off &quot;Ask Before Running&quot;.</li></ol></details>
        <details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold">Android (MacroDroid / Tasker)</summary><ol className="muted list-decimal pl-5 mt-2 space-y-1"><li>Trigger: <b>Device Unlocked</b>, constraint time 06:00–08:00, once per day.</li><li>Action: <b>HTTP Request</b> POST to your link.</li></ol></details>
      </Section>

      <Section title="Safety & plan">
        <div className="divide-y divide-[var(--line)]">
          <Toggle label="Avoid all chillies" hint="Heat from pepper, ginger, mustard seeds instead." on={p.strictCapsicum} onChange={(v) => save({ strictCapsicum: v })} />
          <Toggle label="My doctor knows about this plan" hint="Including the 16:8 window." on={p.clinicianAware} onChange={(v) => save({ clinicianAware: v })} />
        </div>
        <div className="flex items-center justify-between py-3">
          <span>Dinner carb</span>
          <div className="flex gap-1.5">{(["rice", "roti"] as const).map((c) => <button key={c} className="chip !min-h-9" aria-pressed={p.dinnerCarb === c} onClick={() => save({ dinnerCarb: c })}>{c === "rice" ? "Brown rice" : "Jowar roti"}</button>)}</div>
        </div>
        <p className="text-sm muted">Eating window {p.eatingWindow[0]}–{p.eatingWindow[1]} IST. The window and banned foods only change with your doctor, never automatically.</p>
      </Section>

      <Section title="Your changes">
        <p className="text-sm muted mb-3">Changes you confirmed with the coach. They apply to every recipe and swap.</p>
        {personal === null ? <Skeleton h={60} /> : personal.length === 0 ? <p className="text-sm faint">None yet.</p> : (
          <ul className="space-y-2">
            {personal.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-2xl border hair px-3 py-2.5 text-[15px]">
                <span className="flex-1">{r.kind === "substitute" ? `Use ${r.to} instead of ${r.from}` : r.kind === "avoid" ? `Avoid ${r.ingredient}` : r.kind === "hydration_drink" ? `Daily drink: ${r.name}` : r.text}</span>
                <button className="text-sm muted underline underline-offset-4" onClick={async () => { if (confirm("Remove this change? Recipes go back to the plan's version.")) { await post("/api/personalisations", { id: r.id }, { method: "DELETE" }); setPersonal(personal.filter((x) => x.id !== r.id)); } }}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <Link href="/coach" className="btn btn-ghost btn-sm mt-3">Talk to the coach →</Link>
      </Section>

      <Section title="Pantry">
        <p className="text-sm muted mb-3">Tap what&apos;s out. Swaps use what you have.</p>
        {!pantry ? <Skeleton h={120} /> : (
          <div className="flex flex-wrap gap-1.5">
            {pantry.map((it) => (
              <button key={it.key} className="chip !min-h-9 !text-sm" aria-pressed={it.inStock} onClick={async () => { setPantry(pantry.map((x) => (x.key === it.key ? { ...x, inStock: !x.inStock } : x))); await post("/api/pantry", { key: it.key, inStock: !it.inStock }, { queueable: true }); }}>{it.label}</button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Learning">
        <div className="divide-y divide-[var(--line)]">
          <Toggle label="Personalise with my feedback" on={p.consentPersonalisation} onChange={(v) => save({ consentPersonalisation: v })} />
          <Toggle label="Pause learning" on={p.learningPaused} onChange={(v) => save({ learningPaused: v })} />
        </div>
        <Link href="/learned" className="btn btn-ghost btn-sm mt-2">See what EZ FOOD has learned →</Link>
      </Section>

      <Section title="Install">
        <div className="flex gap-3 text-sm"><Smartphone size={20} className="shrink-0" /><div><p><b>iPhone:</b> Safari → Share → Add to Home Screen. Notifications only work from the Home Screen app (iOS 16.4+).</p><p className="mt-2"><b>Android:</b> Chrome → ⋮ → Install app.</p></div></div>
      </Section>

      <Section title="Your data">
        <div className="flex flex-wrap gap-2">
          <a href="/api/export" download="ez-food-export.json" className="btn btn-ghost btn-sm"><Download size={14} />Export everything (JSON)</a>
          <button className="btn btn-ghost btn-sm" onClick={async () => { if (confirm("Delete your account and every log, permanently? This can't be undone.")) { await post("/api/account", {}, { method: "DELETE" }); location.assign(location.origin); } }}><Trash2 size={14} />Delete account</button>
        </div>
      </Section>

      <Section title="About">
        <p className="text-sm muted">EZ FOOD helps you follow the diet plan you and your doctor have chosen. It does not diagnose, treat, or replace medical advice. Nutrition numbers are estimates. It never advises on medicines or supplements: ask your prescribing doctor.</p>
      </Section>
    </AppShell>
  );
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
return (
  <label className="flex items-center gap-3 py-3 cursor-pointer">
    <span className="flex-1"><span className="block">{label}</span>{hint && <span className="text-sm muted">{hint}</span>}</span>
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`w-12 h-7 rounded-full relative transition-all ${on ? "bg-white" : "bg-[var(--line-2)]"}`}><span className={`absolute top-1 w-5 h-5 rounded-full transition-all ${on ? "left-6 bg-black" : "left-1 bg-white"}`} /></button>
  </label>
);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 mt-5">
      <h2 className="eyebrow mb-3">{title}</h2>
      {children}
    </section>
  );
}

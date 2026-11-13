"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Apple, Bean, CalendarDays, ChartNoAxesColumn, ChefHat, Cherry, Citrus, CookingPot, Crown, Droplet, Flame, Gift, GlassWater, House, Leaf, Link as LinkIcon, Medal, Milk, Moon, NotebookPen, Nut, Popcorn, Salad, Settings, Shuffle, Soup, Sparkles, Sprout, Star, Sunrise, Target, Trophy, Utensils, Waves, Wheat, X, Zap, Calendar, ArrowUpRight, MessageCircle,
  type LucideIcon,
} from "lucide-react";

export const ART: Record<string, LucideIcon> = {
  ginger: GlassWater, moong: Bean, sprouts: Sprout, cucumber: Leaf, papaya: Cherry, buttermilk: Milk, lauki: Leaf, dal: Soup, rice: Wheat, khichdi: CookingPot, raita: Milk, chickpea: Popcorn, apple: Apple, curd: Milk, makhana: Popcorn, soup: Soup, fruit: Citrus, nuts: Nut, roti: Wheat, bowl: Salad,
};

export const BADGE_ICON: Record<string, LucideIcon> = {
  glass: GlassWater, sunrise: Sunrise, utensils: Utensils, chef: ChefHat, droplet: Droplet, waves: Waves, shuffle: Shuffle, zap: Zap, link: LinkIcon, flame: Flame, crown: Crown, star: Star, sparkles: Sparkles, notebook: NotebookPen, target: Target, gift: Gift, medal: Medal, trophy: Trophy, calendar: Calendar, moon: Moon,
};

export function Art({ k, size = 22, box = 52, className = "" }: { k?: string; size?: number; box?: number; className?: string }) {
  const Icon = ART[k ?? "bowl"] ?? Salad;
  return (
    <span className={`grid place-items-center rounded-full border hair shrink-0 ${className}`} style={{ width: box, height: box, background: "radial-gradient(circle at 30% 20%, rgba(255,255,255,.14), rgba(255,255,255,.02) 70%)" }} aria-hidden>
      <Icon size={size} strokeWidth={1.6} />
    </span>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold tracking-tight" style={{ fontSize: size * 0.62, letterSpacing: "-0.04em" }}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <rect x="2" y="2" width="60" height="60" rx="18" fill="#fff" />
        <path d="M17 20h17v5H23v5h10v5H23v5h11v5H17z" fill="#000" />
        <path d="M37 20h13v4.6L42.6 39.4H50V45H36.4v-4.6L43.8 25.6H37z" fill="#000" />
      </svg>
      <span>EZ FOOD</span>
    </span>
  );
}

const TABS = [
  { href: "/today", label: "Today", icon: House },
  { href: "/plan", label: "Plan", icon: CalendarDays },
  { href: "/progress", label: "Progress", icon: ChartNoAxesColumn },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Floating glass top bar (like the reference's nav pill) + floating glass tab bar in the thumb zone. */
export function AppShell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const path = usePathname();
  return (
    <div className="min-h-dvh relative overflow-x-clip">
      <div className="glow" style={{ width: 520, height: 520, top: -260, left: "50%", marginLeft: -260 }} />
      <header className="sticky top-0 z-30 pt-[max(10px,env(safe-area-inset-top))] px-3">
        <div className="glass rounded-full max-w-[560px] mx-auto h-[56px] flex items-center justify-between pl-4 pr-2">
          <Link href="/" aria-label="EZ FOOD home"><Logo size={28} /></Link>
          <div className="flex items-center gap-2">
            {right}
            <Link href="/coach" aria-label="Chat with the EZ coach" className="grid place-items-center w-10 h-10 rounded-full border hair hover:bg-white hover:text-black transition-colors"><MessageCircle size={17} /></Link>
          </div>
        </div>
      </header>
      <main className="app-wrap safe-bottom pt-5 relative">{children}</main>
      <nav aria-label="Main" className="fixed z-40 left-1/2 -translate-x-1/2 bottom-[max(14px,env(safe-area-inset-bottom))] glass rounded-full p-1.5 flex gap-1 shadow-[0_20px_60px_-20px_rgba(0,0,0,.9)]">
        {TABS.map((t) => {
          const active = path?.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={`flex flex-col items-center justify-center w-[72px] h-[54px] rounded-full text-[11px] font-semibold transition-all ${active ? "bg-[#f5f5f7] text-black" : "text-[var(--ink-2)] hover:text-white"}`}>
              <Icon size={19} strokeWidth={1.8} />
              <span className="mt-0.5">{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function Sheet({ open, onClose, title, children, tall }: { open: boolean; onClose: () => void; title: string; children: ReactNode; tall?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div ref={ref} tabIndex={-1} className={`relative w-full max-w-[560px] card card-xl card-hi rise rounded-b-none p-5 pb-[calc(24px+env(safe-area-inset-bottom))] overflow-y-auto ${tall ? "max-h-[92dvh]" : "max-h-[85dvh]"}`}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--ink-4)]" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="h3">{title}</h2>
          <button onClick={onClose} className="corner" aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Ring({ value, size = 64, stroke = 5, children, label }: { value: number; size?: number; stroke?: number; children?: ReactNode; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative grid place-items-center shrink-0" style={{ width: size, height: size }} role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <svg width={size} height={size} className="-rotate-90 absolute inset-0">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line-2)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#f5f5f7" strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: "stroke-dashoffset .8s var(--ease)", filter: "drop-shadow(0 0 6px rgba(255,255,255,.5))" }} />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

export type RewardT = { points: number; label: string; lucky?: number };

/** XP toasts that float up, plus a full-screen moment for Lucky Bowls. */
export function useRewards() {
  const [items, setItems] = useState<(RewardT & { id: number })[]>([]);
  const [lucky, setLucky] = useState<number | null>(null);
  const push = (rs: RewardT[] | undefined) => {
    if (!rs?.length) return;
    const now = Date.now();
    setItems((x) => [...x, ...rs.map((r, i) => ({ ...r, id: now + i }))]);
    const l = rs.find((r) => r.lucky);
    if (l) setLucky(l.lucky!);
    setTimeout(() => setItems((x) => x.filter((y) => y.id < now)), 1800 + rs.length * 250);
  };
  const node = (
    <>
      <div className="fixed z-[60] left-1/2 -translate-x-1/2 top-[86px] flex flex-col items-center gap-2 pointer-events-none" aria-live="polite">
        {items.map((r, i) => (
          <div key={r.id} className="float-up glass rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2 whitespace-nowrap" style={{ animationDelay: `${i * 0.18}s` }}>
            <span className="text-black bg-white rounded-full px-2 py-0.5 tabular">+{r.points} XP</span>
            {r.label}
          </div>
        ))}
      </div>
      {lucky !== null && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/80 backdrop-blur" onClick={() => setLucky(null)} role="dialog" aria-label="Lucky Bowl">
          <div className="text-center pop">
            <div className="mx-auto w-28 h-28 rounded-full grid place-items-center pulse-ring" style={{ background: "radial-gradient(circle, #fff 0%, #cfcfd4 70%)" }}>
              <Gift size={48} color="#000" strokeWidth={1.6} />
            </div>
            <p className="eyebrow mt-6">Hidden reward</p>
            <h3 className="h2 mt-2">Lucky Bowl!</h3>
            <p className="muted mt-2">+{lucky} bonus XP. One in five meals hides one.</p>
            <button className="btn btn-primary mt-6" onClick={() => setLucky(null)}>Nice</button>
          </div>
        </div>
      )}
    </>
  );
  return { push, node };
}

export function SectionHead({ eyebrow, title, tail, action }: { eyebrow?: string; title: string; tail?: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div>
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h2 className="text-[26px] font-semibold tracking-[-0.035em] leading-none">
          {title} {tail && <span className="fade-tail">{tail}</span>}
        </h2>
      </div>
      {action}
    </div>
  );
}

export function CornerLink({ href, children, label }: { href: string; children?: ReactNode; label: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2 text-sm muted hover:text-white" aria-label={label}>
      {children}
      <span className="corner"><ArrowUpRight size={14} /></span>
    </Link>
  );
}

export function Skeleton({ h = 80, className = "" }: { h?: number; className?: string }) {
  return <div className={`shimmer rounded-[22px] border hair ${className}`} style={{ height: h }} />;
}

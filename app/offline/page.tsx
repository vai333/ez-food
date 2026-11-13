import Link from "next/link";

export default function Offline() {
  return (
    <main className="min-h-dvh grid place-items-center p-6 text-center">
      <div>
        <span className="pill"><span className="dot" /> Offline</span>
        <h1 className="h2 mt-6">No signal. <span className="fade-tail">Still on plan.</span></h1>
        <p className="muted mt-4 max-w-sm mx-auto">Today&apos;s plan, your recipes and cooking mode work offline once you&apos;ve opened them. Anything you log is saved and synced later.</p>
        <Link href="/today" className="btn btn-primary mt-8">Open Today</Link>
      </div>
    </main>
  );
}

"use client";
import { useEffect } from "react";
import { flushQueue } from "@/lib/client/api";

export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    const onOnline = () => void flushQueue();
    window.addEventListener("online", onOnline);
    void flushQueue();
    if ("clearAppBadge" in navigator) (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge().catch(() => {});
    return () => window.removeEventListener("online", onOnline);
  }, []);
  return null;
}

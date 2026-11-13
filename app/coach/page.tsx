import { Suspense } from "react";
import { CoachClient } from "@/components/coach/CoachClient";

export const metadata = { title: "Coach · EZ FOOD" };
export default function CoachPage() {
  return <Suspense><CoachClient /></Suspense>;
}

import { Suspense } from "react";
import { ProgressClient } from "@/components/progress/ProgressClient";

export const metadata = { title: "Progress · EZ FOOD" };
export default function Page() {
  return <Suspense><ProgressClient /></Suspense>;
}

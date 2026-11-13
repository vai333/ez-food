import { Suspense } from "react";
import { TodayClient } from "@/components/today/TodayClient";

export const metadata = { title: "Today · EZ FOOD" };

export default function TodayPage() {
  return (
    <Suspense>
      <TodayClient />
    </Suspense>
  );
}

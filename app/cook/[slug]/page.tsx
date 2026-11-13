import { Suspense } from "react";
import { CookClient } from "@/components/cook/CookClient";

export const metadata = { title: "Cook · EZ FOOD" };

export default async function CookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense>
      <CookClient slug={slug} />
    </Suspense>
  );
}

import type { Metadata, Viewport } from "next";
import { Rethink_Sans, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { SwRegister } from "@/components/SwRegister";

const rethink = Rethink_Sans({ subsets: ["latin"], variable: "--font-rethink", weight: ["400", "500", "600", "700", "800"] });
const deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-deva", weight: ["400", "600"] });

export const metadata: Metadata = {
  title: "EZ FOOD",
  description: "Eat the plan. Without thinking. A calm, gamified companion for your 7-day anti-inflammatory, liver-friendly plan.",
  applicationName: "EZ FOOD",
  appleWebApp: { capable: true, title: "EZ FOOD", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${rethink.variable} ${deva.variable}`}>
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}

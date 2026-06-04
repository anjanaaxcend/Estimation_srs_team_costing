import { Inter, Space_Grotesk, Instrument_Serif } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";
import { AnimatedBackground } from "@/components/ui/AnimatedBackground";
import { GrainOverlay } from "@/components/ui/GrainOverlay";
import { ScrollToTop } from "@/components/ui/ScrollToTop";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata = {
  title: "ScopeSense AI — Intelligent Project Planning",
  description: "AI-native project planning across SRS, team allocation, and cost estimation.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${instrumentSerif.variable} font-sans antialiased`}
      >
        {/* Layer 0: Animated canvas background */}
        <AnimatedBackground />

        {/* Layer 1: SVG film grain overlay */}
        <GrainOverlay />

        {/* App shell */}
        <Providers>{children}</Providers>

        {/* Floating Scroll to Top Action */}
        <ScrollToTop />
      </body>
    </html>
  );
}

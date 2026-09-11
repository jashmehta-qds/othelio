import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next, Space_Grotesk } from "next/font/google";
import { Providers } from "@/providers/Providers";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin"],
  // Next has no metric override data for this family, so generating one only
  // produces a build warning. The CSS stack remains the intentional fallback.
  adjustFontFallback: false,
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "700"],
});

export const metadata: Metadata = {
  title: "Othelio — Build the basket you want to own",
  description: "Create and manage tokenized stock baskets with transparent backing and scoped agent permissions.",
  icons: {
    icon: [
      { url: "/brand/logo.svg", type: "image/svg+xml" },
      { url: "/brand/logo-transparent.png" },
      { url: "/brand/logo.jpg" },
    ],
    shortcut: "/brand/logo.svg",
    apple: "/brand/logo-transparent.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${atkinson.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

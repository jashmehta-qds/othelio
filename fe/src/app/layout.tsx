import type { Metadata } from "next";
import { Providers } from "@/providers/Providers";
import "./globals.css";
import "./workspace.css";

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
      className="h-full antialiased font-sans"
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:ital,wght@0,200..800;1,200..800&family=Space+Grotesk:wght@500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

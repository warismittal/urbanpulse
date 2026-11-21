import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Navbar } from "@/components/layout/navbar";
import { ClientGate } from "@/components/layout/client-gate";

export const metadata: Metadata = {
  title: "UrbanPulse · Smart city command centre",
  description:
    "Live digital twin of a planned sector city: traffic simulation and adaptive signals, emergency scenarios, computer-vision surveillance, environment monitoring and a citizen app.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Fonts load from Google at runtime (next/font's build-time fetch breaks Turbopack builds for Fraunces). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('urbanpulse_theme');var d=s?s==='dark':true;document.documentElement.classList[d?'add':'remove']('dark');document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="flex min-h-screen flex-col bg-canvas text-ink antialiased" suppressHydrationWarning>
        <Providers>
          <Navbar />
          <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-10 sm:px-6">
            <ClientGate>{children}</ClientGate>
          </main>
          <footer className="border-t border-hair">
            <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-5 text-[12px] text-muted sm:px-6">
              <span>UrbanPulse · smart city command centre</span>
              <span>Digital-twin demo · all data simulated in this browser</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}

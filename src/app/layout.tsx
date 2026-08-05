import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/lib/ThemeProvider";

export const metadata: Metadata = {
  title: "Catalyst — Turn Notes Into Knowledge",
  description:
    "Catalyst automatically turns your raw local notes into an interconnected knowledge graph and active-recall flashcards. Write in any editor — we handle the structure.",
  keywords: ["notes", "flashcards", "knowledge graph", "spaced repetition", "studying"],
  openGraph: {
    title: "Catalyst — Turn Notes Into Knowledge",
    description: "Automatic knowledge graphs and flashcards from your raw notes.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var theme = localStorage.getItem('synthesizer-theme');
              if (theme === 'dark' || theme === 'light') {
                document.documentElement.classList.add(theme);
                document.documentElement.setAttribute('data-theme', theme);
              } else {
                var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                document.documentElement.classList.add(prefersDark ? 'dark' : 'light');
                document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
              }
            } catch(e) {}
          })();
        ` }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}

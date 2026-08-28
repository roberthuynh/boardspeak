import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const nunito = localFont({
  src: "./fonts/nunito-latin-variable.woff2",
  display: "swap",
  variable: "--font-rounded",
  weight: "200 1000",
});

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Boardspeak | Play it by hand. Play it by voice.",
  description:
    "A shared visual board where White plays by mouse and Black plays through a conversational agent using WebMCP.",
  openGraph: {
    title: "Boardspeak | Play it by hand. Play it by voice.",
    description:
      "A shared visual board where White plays by mouse and Black plays through a conversational agent using WebMCP.",
    type: "website",
    images: [
      {
        url: "/art/boardspeak-og.webp",
        width: 1200,
        height: 630,
        alt: "A warm illustrated Breakthrough board shared by mouse and voice players.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Boardspeak | Play it by hand. Play it by voice.",
    description:
      "A shared visual board where White plays by mouse and Black plays through a conversational agent using WebMCP.",
    images: ["/art/boardspeak-og.webp"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={nunito.variable}>{children}</body>
    </html>
  );
}

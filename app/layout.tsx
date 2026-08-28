import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const nunito = localFont({
  src: "./fonts/nunito-latin-variable.woff2",
  display: "swap",
  variable: "--font-rounded",
  weight: "200 1000",
});

export const metadata: Metadata = {
  title: "Boardspeak | Play it by hand. Play it by voice.",
  description:
    "A shared visual board where White plays by mouse and Black plays through a conversational agent using WebMCP.",
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

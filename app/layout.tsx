import type { Metadata } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}

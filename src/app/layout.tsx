import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "台灣即時交通事故監控 — TrafficWatch",
  description: "即時監控台灣交通事故資訊",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}

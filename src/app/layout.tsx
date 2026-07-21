import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradingBot Monitor",
  description:
    "Read-only monitoring dashboard for the multi-strategy Alpaca trading bot",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PilotPulse",
  description: "AI resume analyzer with document upload and grounded chat.",
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

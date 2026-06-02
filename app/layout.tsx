import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PilotPulse",
  description: "CV uploads for job seekers and recruiters.",
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

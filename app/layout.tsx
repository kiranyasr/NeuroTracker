import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neuro Tracker",
  description: "Neuro Tracker productivity workspace"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

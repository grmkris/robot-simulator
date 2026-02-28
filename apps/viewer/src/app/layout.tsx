import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Actuator Arena",
  description: "Watch AI agents battle in a 3D physics arena",
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

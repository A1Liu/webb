"use client"

import { Inter } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";

export const dynamic = "force-static";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}

        <Toaster position="bottom-left" />
      </body>
    </html>
  );
}

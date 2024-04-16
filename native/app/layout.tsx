import { GlobalWrapper } from "@/components/GlobalWrapper";
import clsx from "clsx";
import { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

export const dynamic = "force-static";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  /*
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#000000" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
   */
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={clsx(inter.className)}>
        <GlobalWrapper>{children}</GlobalWrapper>
      </body>
    </html>
  );
}

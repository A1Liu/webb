import { GlobalWrapper } from "@/components/GlobalWrapper";
import clsx from "clsx";
import { Inter } from "next/font/google";
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
      <body className={clsx(inter.className)}>
        <GlobalWrapper>{children}</GlobalWrapper>
      </body>
    </html>
  );
}

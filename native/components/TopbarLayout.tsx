"use client";

import clsx from "clsx";
import Link from "next/link";
import React from "react";

interface TopbarLayoutProps {
  title: string;
  buttons: (
    | { type: "button"; text: string; onClick: () => unknown }
    | { type: "link"; text: string; href: string }
  )[];
  children?: React.ReactNode;
}

export const buttonClass =
  "bg-sky-700 px-2 py-1 rounded hover:bg-sky-900 p-10 disabled:hover:bg-sky-700";

export function TopbarLayout({ title, buttons, children }: TopbarLayoutProps) {
  // py-24 px-8
  return (
    <main className={clsx("flex h-full flex-col gap-2")}>
      <div className="flex justify-between items-center px-4 py-1 w-full border-b border-slate-400">
        <h4>{title}</h4>

        <div className="flex gap-2 flex-wrap">
          {buttons.map((buttonInfo) => {
            switch (buttonInfo.type) {
              case "link":
                return (
                  <Link
                    key={`${buttonInfo.type}-${buttonInfo.text}-${buttonInfo.href}`}
                    href={buttonInfo.href}
                  >
                    <button className={buttonClass}>{buttonInfo.text}</button>
                  </Link>
                );
              case "button":
                return (
                  <button
                    key={`${buttonInfo.type}-${buttonInfo.text}`}
                    className={buttonClass}
                    onClick={() => buttonInfo.onClick()}
                  >
                    {buttonInfo.text}
                  </button>
                );
            }
          })}
        </div>
      </div>

      <div
        className={
          "flex flex-col gap-4 w-full flex-grow pb-4 overflow-y-scroll scrollbar-hidden"
        }
      >
        {children}
      </div>
    </main>
  );
}

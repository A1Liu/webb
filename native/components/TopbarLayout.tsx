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
  children: React.ReactNode;
}

const buttonClass = "bg-sky-700 p-2 rounded hover:bg-sky-900 p-10";

export function TopbarLayout({ title, buttons, children }: TopbarLayoutProps) {
  // py-24 px-8
  return (
    <main className={clsx("flex h-full flex-col gap-4")}>
      <div className="flex gap-2 flex-wrap justify-end w-full p-4">
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

      <h4 className="text-center">{title}</h4>

      <div className={"flex flex-col gap-4 px-2 w-full"}>{children}</div>
    </main>
  );
}

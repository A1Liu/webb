import clsx from "clsx";
import React from "react";
import { Link } from "react-router-dom";
import { Button } from "./design-system/Button";

interface TopbarLayoutProps {
  title: string;
  buttons: (
    | { type: "button"; text: string; onClick: () => unknown }
    | { type: "link"; text: string; href: string }
  )[];
  children?: React.ReactNode;
}

export function TopbarLayout({ title, buttons, children }: TopbarLayoutProps) {
  // py-24 px-8
  return (
    <main className={clsx("flex h-full flex-col bg-black text-white")}>
      <div className="flex justify-between items-center pl-2 pr-5 py-1 w-full border-b border-slate-400">
        <div className="flex gap-2 items-center">
          {import.meta.env.DEV ? (
            <div className="rounded-md p-1 bg-red-500 text-xs font-bold">
              DEV
            </div>
          ) : null}
          <h4>{title}</h4>
        </div>

        <div className="flex gap-2 flex-wrap">
          {buttons.map((buttonInfo) => {
            switch (buttonInfo.type) {
              case "link":
                return (
                  <Link
                    key={`${buttonInfo.type}-${buttonInfo.text}-${buttonInfo.href}`}
                    to={buttonInfo.href}
                    className="flex"
                  >
                    <Button size="xs">{buttonInfo.text}</Button>
                  </Link>
                );
              case "button":
                return (
                  <Button
                    size="xs"
                    key={`${buttonInfo.type}-${buttonInfo.text}`}
                    onClick={() => buttonInfo.onClick()}
                  >
                    {buttonInfo.text}
                  </Button>
                );
            }
          })}
        </div>
      </div>

      <div
        className={
          "flex flex-col gap-4 w-full flex-grow overflow-y-scroll scrollbar-hidden"
        }
      >
        {children}
      </div>
    </main>
  );
}

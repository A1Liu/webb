"use client";

import React from "react";
import clsx from "clsx";
import Link from "next/link";

export const dynamic = "force-static";

const buttonClass = "bg-sky-700 p-2 rounded hover:bg-sky-900 p-10";

export default function Home() {
  return (
    <main
      className={clsx("flex h-full flex-col items-center gap-4 py-24 px-8")}
    >
      <h4>Home</h4>

      <div className="flex flex-col gap-2 flex-wrap">
        <button
          className={buttonClass}
          onClick={() => window.location.reload()}
        >
          Refresh
        </button>

        <Link href={"/settings"}>
          <button className={buttonClass}>Settings</button>
        </Link>
      </div>
    </main>
  );
}

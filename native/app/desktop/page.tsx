"use client";

import React from "react";
import { toast } from "react-hot-toast";
import clsx from "clsx";
import Link from "next/link";
import { usePeer } from "@/components/hooks/usePeer";

export const dynamic = "force-static";

const buttonClass = "bg-sky-700 p-2 rounded hover:bg-sky-900";

export default function Home() {
  const { connect, send } = usePeer("aliu-web-id", {
    onData: (data) => {
      toast(`data=${data}`);
    },
  });

  return (
    <main
      className={clsx("flex h-full flex-col items-center gap-4 py-24 px-8")}
    >
      <h4>Desktop</h4>

      <div className="flex gap-2 flex-wrap">
        <button
          className={buttonClass}
          onClick={() => window.location.reload()}
        >
          Refresh
        </button>

        <Link href={"/my-qr-code"}>
          <button className={buttonClass}>QR</button>
        </Link>

        <button className={buttonClass} onClick={() => connect()}>
          connect
        </button>

        <button className={buttonClass} onClick={() => send("hello")}>
          send hi
        </button>

        <button className={buttonClass} onClick={() => toast("hello")}>
          hi
        </button>
      </div>
    </main>
  );
}

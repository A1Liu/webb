"use client";

import React, { useEffect, useRef } from "react";
import { toast } from "react-hot-toast";
import clsx from "clsx";
import Link from "next/link";
import { IncomingPeers } from "@/components/hooks/usePeer";
import { toCanvas } from "qrcode";
import { getId } from "@a1liu/webb-ui-shared/util";

export const dynamic = "force-static";

const buttonClass = "bg-sky-700 p-2 rounded hover:bg-sky-900";

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    toCanvas(canvasRef.current, getId()).catch((error) => {
      toast.error(`QR Code error: ${String(error)}`, {
        duration: 30_000,
      });
    });
  }, []);

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

        <button className={buttonClass} onClick={() => toast("hello")}>
          hi
        </button>
      </div>

      <canvas ref={canvasRef}></canvas>

      <IncomingPeers />
    </main>
  );
}

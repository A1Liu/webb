"use client";

import React, { useEffect, useRef } from "react";
import { Format, scan } from "@tauri-apps/plugin-barcode-scanner";
import { toast } from "react-hot-toast";
import clsx from "clsx";
import { useModifyGlobals, usePersistedState } from "@/components/globals";
import Link from "next/link";
import { IncomingPeers, usePeer } from "@/components/hooks/usePeer";
import { usePlatform } from "@/components/hooks/usePlatform";
import { toCanvas } from "qrcode";
import { getId } from "@a1liu/webb-ui-shared/util";

export const dynamic = "force-static";

const buttonClass = "bg-sky-700 p-2 rounded hover:bg-sky-900";

export default function Home() {
  const { isMobile, platform } = usePlatform();
  const { otherDeviceId } = usePersistedState();
  const cb = useModifyGlobals();
  const { connect } = usePeer(otherDeviceId ?? "", {
    onData: (data) => {
      toast(`data=${data}`);
    },
  });

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
      <h4>{platform}</h4>

      <h6>Target: {otherDeviceId}</h6>

      <div className="flex gap-2 flex-wrap">
        <Link href={"/"}>
          <button className={buttonClass}>Home</button>
        </Link>

        <button
          className={buttonClass}
          onClick={() => window.location.reload()}
        >
          Refresh
        </button>

        <Link href={"/my-qr-code"}>
          <button className={buttonClass}>QR</button>
        </Link>

        {isMobile ? (
          <button
            className={buttonClass}
            onTouchStart={async () => {
              await cb.runBackgroundFlow(async () => {
                // `windowed: true` actually sets the webview to transparent
                // instead of opening a separate view for the camera
                // make sure your user interface is ready to show what is underneath with a transparent element
                const result = await scan({
                  cameraDirection: "back",
                  windowed: true,
                  formats: [Format.QRCode],
                });

                toast(result.content);
                cb.setOtherDeviceId(result.content);
              });
            }}
          >
            scan
          </button>
        ) : null}

        <button
          className={buttonClass}
          disabled={!otherDeviceId}
          onClick={() => connect()}
        >
          connect
        </button>

        <button className={buttonClass} onClick={() => toast("hello")}>
          hi
        </button>
      </div>

      <canvas ref={canvasRef}></canvas>

      <IncomingPeers />
    </main>
  );
}

"use client";
import React from "react";
import { Format, scan } from "@tauri-apps/plugin-barcode-scanner";
import { toast } from "react-hot-toast";
import clsx from "clsx";
import { useGlobals } from "@/components/globals";
import Link from "next/link";

export const dynamic = "force-static";

/*
import { getId, memoize } from "@a1liu/webb-ui-shared/util";
import { NetworkLayer, PeerConnection } from "@a1liu/webb-ui-shared/network";
import  { useRef } from "react";

export const dynamic = "force-static";

declare global {
  interface Window {
    peer?: NetworkLayer;
  }
}

const getNetworkLayerGlobal = memoize(() => {
  return new NetworkLayer(getId());
});

interface PeerContext {
  connect: () => Promise<void>;
  send: (s: string) => void;
}

function usePeer(
  target: string,
  opts: { onData: (data: unknown) => void },
): PeerContext {
  const connectionRef = useRef<PeerConnection>();
  const dataListenerRef = useRef<(data: unknown) => void>(opts.onData);

  dataListenerRef.current = opts.onData;

  return {
    connect: async () => {
      const layer = getNetworkLayerGlobal();
      const conn = await layer.connect(target);

      if (connectionRef.current !== undefined) {
        connectionRef.current.close();
      }

      connectionRef.current = conn;
    },
    send: (s) => {
      if (connectionRef.current === undefined) {
        return;
      }

      const channel = connectionRef.current.defaultChannel;
      channel.send(new TextEncoder().encode(s));
    },
  };
}
 */

const buttonClass = "bg-sky-700 p-2 rounded hover:bg-sky-900";

export default function Home() {
  const { cb } = useGlobals();

  return (
    <main
      className={clsx("flex h-full flex-col items-center gap-4 py-24 px-8")}
    >
      <h4>Home</h4>

      <div className="flex gap-2">
        <button
          className={buttonClass}
          onClick={() => window.location.reload()}
        >
          Refresh
        </button>

        <Link href={"/my-qr-code"}>
          <button className={buttonClass}>My QR Code</button>
        </Link>

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
            });
          }}
        >
          scan
        </button>

        <button className={buttonClass} onClick={() => toast("hello")}>
          hi
        </button>
      </div>
    </main>
  );
}

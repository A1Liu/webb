"use client";

import React, { useEffect, useState } from "react";
import { Format, scan } from "@tauri-apps/plugin-barcode-scanner";
import { toast } from "react-hot-toast";
import clsx from "clsx";

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
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    toast("Init");
  }, []);

  return (
    <main
      className={clsx(
        "flex min-h-screen flex-col items-center justify-between p-24",
        hidden && "bg-transparent",
      )}
    >
      <div className="flex gap-2">
        <button
          className={buttonClass}
          onClick={() => window.location.reload()}
        >
          Refresh
        </button>

        <button
          className={buttonClass}
          onTouchStart={async () => {
            setHidden(true);

            // `windowed: true` actually sets the webview to transparent
            // instead of opening a separate view for the camera
            // make sure your user interface is ready to show what is underneath with a transparent element
            const result = await scan({
              windowed: true,
              formats: [Format.QRCode],
            });

            setHidden(false);

            toast(result.content);
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

"use client";

import { v4 as uuid } from "uuid";
import React, { useEffect, useRef, useState } from "react";
import { Format, scan } from "@tauri-apps/plugin-barcode-scanner";
import { toast } from "react-hot-toast";
import { useGlobals } from "@/components/globals";
import { IncomingPeers } from "@/components/hooks/usePeer";
import { usePlatform } from "@/components/hooks/usePlatform";
import { toCanvas } from "qrcode";
import { getId } from "@a1liu/webb-ui-shared/util";
import { TopbarLayout } from "@/components/TopbarLayout";
import { useDebounceFn, useMemoizedFn } from "ahooks";
import { usePeers } from "@/components/state/peers";
import { useNotesState } from "@/components/state/notes";

export const dynamic = "force-static";

const buttonClass = "bg-sky-700 p-2 rounded hover:bg-sky-900";

export default function Home() {
  const { isMobile, platform } = usePlatform();
  const { peers, cb } = usePeers();
  const globals = useGlobals((s) => s.cb);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [resetCount, setResetCounter] = useState(5);
  const hardReset = useMemoizedFn(async () => {
    if (resetCount > 1) {
      setResetCounter((prev) => prev - 1);
      return;
    }

    usePeers.setState({ peers: new Map() });
    useNotesState.setState({ notes: new Map(), activeNote: uuid() });
    setResetCounter(5);
  });

  const { run } = useDebounceFn(
    (): void => setResetCounter((prev) => Math.min(5, prev + 1)),
    {
      wait: 1_000,
      trailing: true,
    },
  );

  useEffect(() => {
    if (resetCount >= 5) return;
    run();
  }, [resetCount]);

  useEffect(() => {
    if (!canvasRef.current) return;

    toCanvas(canvasRef.current, getId()).catch((error) => {
      toast.error(`QR Code error: ${String(error)}`, {
        duration: 30_000,
      });
    });
  }, []);

  return (
    <TopbarLayout
      title={`${platform} Settings`}
      buttons={[
        {
          type: "link",
          text: "Home",
          href: "/",
        },
        {
          type: "button",
          text: "Refresh",
          onClick: () => window.location.reload(),
        },
      ]}
    >
      <div className={"flex gap-2 justify-center"}>
        <canvas ref={canvasRef}></canvas>

        <div className="flex flex-col gap-2">
          {isMobile ? (
            <button
              className={buttonClass}
              onTouchStart={async () => {
                await globals.runBackgroundFlow(async () => {
                  // `windowed: true` actually sets the webview to transparent
                  // instead of opening a separate view for the camera
                  // make sure your user interface is ready to show what is underneath with a transparent element
                  const result = await scan({
                    cameraDirection: "back",
                    windowed: true,
                    formats: [Format.QRCode],
                  });

                  toast(result.content);

                  cb.addPeer({ id: result.content });
                });
              }}
            >
              scan
            </button>
          ) : null}

          <button className={buttonClass} onClick={() => toast("hello")}>
            hi
          </button>

          <button className={buttonClass} onClick={() => hardReset()}>
            HARD RESET ({resetCount} clicks to activate)
          </button>
        </div>
      </div>

      <IncomingPeers peers={[...(peers ? peers?.values() : [])]} />
    </TopbarLayout>
  );
}

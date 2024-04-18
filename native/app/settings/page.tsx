"use client";

import React, { useEffect, useRef, useState } from "react";
import { Format, scan } from "@tauri-apps/plugin-barcode-scanner";
import { toast } from "react-hot-toast";
import { useGlobals } from "@/components/state/appGlobals";
import { IncomingPeers } from "@/components/hooks/usePeer";
import { usePlatform } from "@/components/hooks/usePlatform";
import { toCanvas } from "qrcode";
import { TopbarLayout } from "@/components/TopbarLayout";
import { useDebounceFn, useMemoizedFn } from "ahooks";
import { usePeers } from "@/components/state/peers";
import {
  NoteDateSchemaOld,
  readNoteContents,
  useNotesState,
  writeNoteContents,
} from "@/components/state/notes";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import md5 from "md5";
import { getNetworkLayerGlobal } from "@/components/network";
import Link from "next/link";
import { useDeviceProfile } from "@/components/state/deviceProfile";

export const dynamic = "force-static";

const buttonClass = "bg-sky-700 p-2 rounded hover:bg-sky-900";

export default function Settings() {
  const { isMobile, platform } = usePlatform();
  const { peers, cb } = usePeers();
  const { deviceProfile } = useDeviceProfile();
  const notesCb = useNotesState((s) => s.cb);
  const globals = useGlobals((s) => s.cb);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [resetCount, setResetCounter] = useState(5);
  const hardReset = useMemoizedFn(async () => {
    if (resetCount > 1) {
      setResetCounter((prev) => prev - 1);
      return;
    }

    usePeers.persist.clearStorage();
    useNotesState.persist.clearStorage();
    window.location.reload();
  });

  const { run } = useDebounceFn(
    (): void => setResetCounter((prev) => Math.min(5, prev + 1)),
    {
      wait: 1_000,
      trailing: true,
    }
  );

  useEffect(() => {
    if (resetCount >= 5) return;
    run();
  }, [resetCount]);

  useEffect(() => {
    if (!canvasRef.current || !deviceProfile) return;

    toCanvas(canvasRef.current, deviceProfile.id).catch((error) => {
      toast.error(`QR Code error: ${String(error)}`, {
        duration: 30_000,
      });
    });
  }, [deviceProfile]);

  return (
    <TopbarLayout
      title={`${platform} Settings`}
      buttons={[
        {
          type: "button",
          text: "Back",
          onClick: () => window.history.back(),
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

                  cb.updatePeer({ id: result.content });

                  const network = await getNetworkLayerGlobal();
                  network.sendData({
                    peerId: result.content,
                    channel: "debug",
                    data: "peer connect",
                  });
                });
              }}
            >
              scan
            </button>
          ) : null}

          {!isMobile ? (
            <>
              <button
                className={buttonClass}
                onClick={async () => {
                  const data = await Promise.all(
                    [...useNotesState.getState().notes.values()].map(
                      async (note) => {
                        const text = (await readNoteContents(note.id)) ?? "";
                        return {
                          ...note,
                          text,
                        };
                      }
                    )
                  );

                  const json = JSON.stringify(data);

                  await writeText(json);

                  console.log("backup done");

                  toast.success(`Copied to clipboard`);
                }}
              >
                Backup
              </button>

              <button
                className={buttonClass}
                onClick={async () => {
                  try {
                    const text = await readText();
                    const data = JSON.parse(text);
                    const notes = NoteDateSchemaOld.array()
                      .parse(data)
                      .map((note) => {
                        return {
                          ...note,
                          hash: md5(note.text),
                          preview: note.text.split("\n", 1)[0].slice(0, 20),
                        };
                      });

                    notesCb.updateNotesFromSync(
                      notes.map(({ text, ...note }) => note)
                    );

                    for (const note of notes) {
                      await writeNoteContents(note.id, note.text);
                    }

                    toast.success(`Restored from clipboard`);
                  } catch (e) {
                    toast.error(`Failed to restore`);
                    console.error(e);
                  }
                }}
              >
                Restore
              </button>
            </>
          ) : null}

          <Link href={"/"}>
            <button className={buttonClass}>Home</button>
          </Link>

          <button className={buttonClass} onClick={() => hardReset()}>
            HARD RESET ({resetCount} clicks to activate)
          </button>
        </div>
      </div>

      <IncomingPeers peers={[...(peers ? peers?.values() : [])]} />
    </TopbarLayout>
  );
}

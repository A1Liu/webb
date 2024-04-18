"use client";

import React, { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { IncomingPeers } from "@/components/hooks/usePeer";
import { usePlatform } from "@/components/hooks/usePlatform";
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
import Link from "next/link";
import { DeviceQr, ScanAndConnectButton } from "@/components/DeviceQrCode";
import { useUserProfile } from "@/components/state/userProfile";
import { useDeviceProfile } from "@/components/state/deviceProfile";

export const dynamic = "force-static";

const buttonClass = "bg-sky-700 p-2 rounded hover:bg-sky-900";

export default function Settings() {
  const { isMobile, platform } = usePlatform();
  const { peers } = usePeers();
  const notesCb = useNotesState((s) => s.cb);

  const [resetCount, setResetCounter] = useState(5);
  const hardReset = useMemoizedFn(async () => {
    if (resetCount > 1) {
      setResetCounter((prev) => prev - 1);
      return;
    }

    usePeers.persist.clearStorage();
    useNotesState.persist.clearStorage();
    useUserProfile.persist.clearStorage();
    useDeviceProfile.persist.clearStorage();
    window.location.reload();
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
        <DeviceQr />

        <div className="flex flex-col gap-2">
          <ScanAndConnectButton />

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
                      },
                    ),
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
                      notes.map(({ text, ...note }) => note),
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

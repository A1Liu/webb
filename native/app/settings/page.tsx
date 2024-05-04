"use client";

import React from "react";
import { toast } from "react-hot-toast";
import { IncomingPeers } from "@/app/settings/IncomingPeers";
import { usePlatform } from "@/components/hooks/usePlatform";
import { buttonClass, TopbarLayout } from "@/components/TopbarLayout";
import { useLockFn, useMemoizedFn } from "ahooks";
import { usePeers } from "@/components/state/peers";
import { NoteDataSchema, useNotesState } from "@/components/state/notes";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import Link from "next/link";
import { DeviceQr, ScanAndConnectButton } from "@/components/DeviceQrCode";
import {
  UserProfileSerializedSchema,
  useUserProfile,
} from "@/components/state/userProfile";
import {
  readNoteContents,
  writeNoteContents,
} from "@/components/state/noteContents";
import { z } from "zod";
import { useLocks } from "@/components/state/locks";
import { useRouter } from "next/navigation";
import { TapCounterButton } from "@/components/Button";
import { clear } from "idb-keyval";

export const dynamic = "force-static";

function BackupAndRestore<T>({
  title,
  fetchData,
  writeData,
  schema,
}: {
  title: string;
  fetchData: () => Promise<T>;
  writeData: (t: T) => Promise<void>;
  schema: z.ZodSchema<T>;
}) {
  const { isMobile } = usePlatform();
  if (isMobile) return null;

  return (
    <div className="flex gap-2 items-center">
      <p className="font-bold uppercase flex-grow">{title}</p>

      <button
        className={buttonClass}
        onClick={async () => {
          const data = await fetchData();

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

            await writeData(schema.parse(data));

            toast.success(`Restored from clipboard`);
          } catch (e) {
            toast.error(`Failed to restore`);
            console.error(e);
          }
        }}
      >
        Restore
      </button>
    </div>
  );
}

function BackupUser() {
  return (
    <BackupAndRestore
      title={"user"}
      schema={UserProfileSerializedSchema}
      fetchData={async () => {
        const userProfile = useUserProfile.getState()._userProfileSerialized;
        if (!userProfile) {
          throw new Error("no UserProfile");
        }

        return userProfile;
      }}
      writeData={async (userProfileData) => {
        await useUserProfile
          .getState()
          .cb.updateUserProfileFromSerialized(userProfileData);
      }}
    />
  );
}

export default function Settings() {
  const { platform } = usePlatform();
  const { peers } = usePeers();
  const notesCb = useNotesState((s) => s.cb);
  const {
    userProfile,
    cb: { logout, createUserProfile },
  } = useUserProfile();

  const router = useRouter();

  const hardReset = useMemoizedFn(async () => {
    await clear();

    window.location.reload();
  });

  const createUser = useLockFn(createUserProfile);

  return (
    <TopbarLayout
      title={`${platform} Settings`}
      buttons={[
        {
          type: "button",
          text: "⏪ Back",
          onClick: () => router.back(),
        },
        {
          type: "button",
          text: "😵",
          onClick: () => window.location.reload(),
        },
      ]}
    >
      <div className={"flex gap-2 justify-center"}>
        <DeviceQr />

        <div className="flex flex-col gap-2">
          <ScanAndConnectButton />

          <BackupAndRestore
            title={"notes"}
            schema={NoteDataSchema.extend({
              text: z.string().nullish(),
            }).array()}
            fetchData={async () => {
              return await Promise.all(
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
            }}
            writeData={async (notes) => {
              // TODO: Eventually, maybe locks should be included.
              // Or it should be easier to lock and unlock things,
              // and categorize them.
              notesCb.updateNotesFromSync(
                notes.map(({ text, lockId, ...note }) => note),
              );

              for (const note of notes) {
                if (!note.text) continue;
                await writeNoteContents(note.id, note.text);
              }
            }}
          />

          <BackupUser />

          <Link href={"/"}>
            <button className={buttonClass}>Home</button>
          </Link>

          <TapCounterButton
            counterLimit={5}
            className={buttonClass}
            onClick={() => hardReset()}
          >
            HARD RESET
          </TapCounterButton>

          <button className={buttonClass} onClick={() => notesCb.lockAll()}>
            Lock All
          </button>

          <button
            className={buttonClass}
            onClick={async () => {
              const { locks, cb } = useLocks.getState();
              if (locks.size > 0) {
                toast("Already have lock", {});
                return;
              }

              await cb.createLock("main");

              toast("created lock", {});
            }}
          >
            Create lock
          </button>
        </div>
      </div>

      {userProfile ? (
        <h4 className="text-left text-wrap break-words overflow-hidden">
          USER: {userProfile?.publicAuthUserId}
        </h4>
      ) : (
        <h4>NO USER</h4>
      )}

      <div className="flex gap-2">
        {userProfile ? (
          <TapCounterButton
            counterLimit={5}
            className={buttonClass}
            onClick={() => {
              logout();
              toast("Created user profile");
            }}
          >
            Logout
          </TapCounterButton>
        ) : (
          <button className={buttonClass} onClick={createUser}>
            Create User
          </button>
        )}
      </div>

      <IncomingPeers peers={[...(peers ? peers?.values() : [])]} />
    </TopbarLayout>
  );
}

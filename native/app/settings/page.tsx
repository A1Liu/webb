"use client";

import React from "react";
import { toast } from "react-hot-toast";
import { IncomingPeers } from "@/app/settings/IncomingPeers";
import { usePlatform } from "@/components/hooks/usePlatform";
import { TopbarLayout } from "@/components/TopbarLayout";
import { useMemoizedFn } from "ahooks";
import { usePeers } from "@/components/state/peers";
import { NoteDataSchema, useNotesState } from "@/components/state/notes";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import Link from "next/link";
import { DeviceQr, ScanAndConnectButton } from "@/components/DeviceQrCode";
import { useUserProfile } from "@/components/state/userProfile";
import { useDeviceProfile } from "@/components/state/deviceProfile";
import {
  readNoteContents,
  writeNoteContents,
} from "@/components/state/noteContents";
import { z } from "zod";
import {
  base64ToBytes,
  bytesToBase64,
  exportUserPublickKey,
  importUserPublicKey,
  verifyUserKey,
} from "@/components/crypto";
import { useLocks } from "@/components/state/locks";
import { useRouter } from "next/navigation";
import { TapCounterButton } from "@/components/Button";

export const dynamic = "force-static";

const buttonClass = "bg-sky-700 p-2 rounded hover:bg-sky-900";

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
      schema={z.object({
        publicAuthUserId: z.string(),
        publicAuthKeyBase64: z.string(),
        secret: z.object({
          privateAuthKeyBase64: z.string(),
          privateEncryptKeyBase64: z.string(),
        }),
      })}
      fetchData={async () => {
        const userProfile = useUserProfile.getState().userProfile;
        if (!userProfile) {
          throw new Error("no UserProfile");
        }

        const pubKey = await exportUserPublickKey(userProfile.publicAuthKey);

        const secret = await (async () => {
          if (!userProfile.secret) return undefined;

          const privAuthKey = await window.crypto.subtle.exportKey(
            "pkcs8",
            userProfile.secret.privateAuthKey
          );
          const privEncryptKey = await window.crypto.subtle.exportKey(
            "raw",
            userProfile.secret.privateEncryptKey
          );

          return {
            privateAuthKeyBase64: bytesToBase64(privAuthKey),
            privateEncryptKeyBase64: bytesToBase64(privEncryptKey),
          };
        })();

        return {
          publicAuthUserId: userProfile.publicAuthUserId,
          publicAuthKeyBase64: pubKey,
          secret,
        };
      }}
      writeData={async (userProfileData) => {
        const pubKey = await importUserPublicKey(
          userProfileData.publicAuthKeyBase64
        );

        const secret = await (async () => {
          if (!userProfileData.secret) return undefined;

          const privateAuthKey = await window.crypto.subtle.importKey(
            "pkcs8",
            base64ToBytes(userProfileData.secret.privateAuthKeyBase64),
            {
              name: "RSA-PSS",
              hash: "SHA-512",
            },
            true,
            ["sign"]
          );
          const privateEncryptKey = await window.crypto.subtle.importKey(
            "raw",
            base64ToBytes(userProfileData.secret.privateEncryptKeyBase64),
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
          );

          return {
            privateAuthKey,
            privateEncryptKey,
          };
        })();

        const verified = await verifyUserKey(
          pubKey,
          userProfileData.publicAuthUserId
        );
        if (!verified) {
          throw new Error("User profile failed verification");
        }

        useUserProfile.getState().cb.updateUserProfile({
          publicAuthUserId: userProfileData.publicAuthUserId,
          publicAuthKey: pubKey,
          secret,
        });
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
    cb: { logout },
  } = useUserProfile();

  const router = useRouter();

  const hardReset = useMemoizedFn(async () => {
    usePeers.persist.clearStorage();
    useNotesState.persist.clearStorage();
    useUserProfile.persist.clearStorage();
    useDeviceProfile.persist.clearStorage();
    useLocks.persist.clearStorage();
    window.location.reload();
  });

  return (
    <TopbarLayout
      title={`${platform} Settings`}
      buttons={[
        {
          type: "button",
          text: "Back",
          onClick: () => router.back(),
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
                  }
                )
              );
            }}
            writeData={async (notes) => {
              notesCb.updateNotesFromSync(
                notes.map(({ text, ...note }) => note)
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

      <h4>USER: {userProfile?.publicAuthUserId}</h4>

      <div className="flex gap-2">
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
      </div>

      <IncomingPeers peers={[...(peers ? peers?.values() : [])]} />
    </TopbarLayout>
  );
}

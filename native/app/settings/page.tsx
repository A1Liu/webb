import React from "react";
import { toast } from "react-hot-toast";
import { IncomingPeers } from "@/app/settings/IncomingPeers";
import { usePlatform } from "@/components/hooks/usePlatform";
import { buttonClass, TopbarLayout } from "@/components/TopbarLayout";
import { useLockFn, useMemoizedFn } from "ahooks";
import { usePeers } from "@/components/state/peers";
import { NoteDataSchema, useNotesState } from "@/components/state/notes";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { DeviceQr, ScanAndConnectButton } from "@/components/DeviceQrCode";
import {
  getUserProfileSerialized,
  UserProfileSerializedSchema,
  useUserProfile,
} from "@/components/state/userProfile";
import {
  updateNoteDocAsync,
  ZustandIdbNotesStorage,
} from "@/components/state/noteContents";
import { z, ZodTypeDef } from "zod";
import { TapCounterButton } from "@/components/Button";
import { clear } from "idb-keyval";
import { usePermissionCache } from "@/components/state/permissions";
import { PermissionsManager } from "@/components/permissions";
import { useDeviceProfile } from "@/components/state/deviceProfile";
import { Link, useNavigate } from "react-router-dom";

export const dynamic = "force-static";

function BackupAndRestore<T>({
  title,
  toastId,
  fetchData,
  writeData,
  schema,
}: {
  title: string;
  toastId: string;
  fetchData: () => Promise<T>;
  writeData: (t: T) => Promise<void>;
  schema: z.ZodSchema<T, ZodTypeDef, unknown>;
}) {
  const { isMobile } = usePlatform();
  if (isMobile) return null;

  return (
    <div className="flex gap-2 items-center">
      <p className="font-bold uppercase flex-grow">{title}</p>

      <button
        className={buttonClass}
        onClick={async () => {
          try {
            toast.loading(`Loading...`, { id: toastId });
            const data = await fetchData();

            const json = JSON.stringify(data);
            await writeText(json);

            console.log("backup done");
            toast.success(`Copied to clipboard`, { id: toastId });
          } catch (e) {
            toast.error(`Failed to backup`, { id: toastId });
            console.error(e);
          }
        }}
      >
        Backup
      </button>

      <button
        className={buttonClass}
        onClick={async () => {
          try {
            toast.loading(`Loading...`, { id: toastId });
            const text = await readText();
            const data = JSON.parse(text);

            await writeData(schema.parse(data));

            toast.success(`Restored from clipboard`, { id: toastId });
          } catch (e) {
            toast.error(`Failed to restore`, { id: toastId });
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
  const toastId = "backup-users";
  return (
    <BackupAndRestore
      title={"user"}
      toastId={toastId}
      schema={UserProfileSerializedSchema}
      fetchData={async () => {
        const userProfile = await getUserProfileSerialized();
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

  const navigate = useNavigate();

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
          onClick: () => navigate(-1),
        },
        {
          type: "button",
          text: "😵",
          onClick: () => window.location.reload(),
        },
      ]}
    >
      <div className={"flex gap-2 justify-center p-2"}>
        <DeviceQr />

        <div className="flex flex-col gap-2">
          <ScanAndConnectButton />

          <BackupAndRestore
            title={"notes"}
            toastId={"write-note-data"}
            schema={NoteDataSchema.extend({
              text: z.string().nullish(),
            }).array()}
            fetchData={async () => {
              return await Promise.all(
                [...useNotesState.getState().notes.values()].map(
                  async (note) => {
                    const text =
                      (
                        await ZustandIdbNotesStorage.getItem(note.id)
                      )?.state.doc.contents?.toString() ?? "";
                    return {
                      ...note,
                      text,
                    };
                  },
                ),
              );
            }}
            writeData={async (notes) => {
              notesCb.updateNotesFromSync(
                notes.map(({ text, ...note }) => note),
              );

              let index = 0;
              for (const note of notes) {
                toast.loading(`Writing note data... ${++index}`, {
                  id: "write-note-data",
                });

                if (!note.text) continue;
                await updateNoteDocAsync(note.id, note.text);
              }
            }}
          />

          <BackupUser />

          <Link to={"/"}>
            <button className={buttonClass}>Home</button>
          </Link>

          <TapCounterButton
            counterLimit={5}
            className={buttonClass}
            onClick={() => hardReset()}
          >
            HARD RESET
          </TapCounterButton>

          <button
            className={buttonClass}
            onClick={async () => {
              const { userProfile } = useUserProfile.getState();
              const { deviceProfile } = useDeviceProfile.getState();
              if (!userProfile?.secret || !deviceProfile) return false;

              const { permissionCache, cb } = usePermissionCache.getState();
              const permissions = new PermissionsManager(
                deviceProfile.id,
                userProfile?.id,
                permissionCache,
              );

              await permissions.createPermission(
                {
                  deviceId: [{ __typename: "Exact", value: deviceProfile.id }],
                  userId: [
                    {
                      __typename: "Exact",
                      value: userProfile.id,
                    },
                  ],
                  resourceId: [{ __typename: "Any" }],
                  actionId: [{ __typename: "Any" }],
                  allow: true,
                },
                "userRoot",
                { ...userProfile, ...userProfile.secret },
              );

              cb.updateCache(permissions.permissionCache);

              toast.success("Now I have perms!");
            }}
          >
            Give Self Perms
          </button>
        </div>
      </div>

      {userProfile ? (
        <h4 className="text-left text-wrap break-words overflow-hidden">
          USER: {userProfile?.id}
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

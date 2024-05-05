"use client";

import React from "react";
import { useNotesState } from "@/components/state/notes";
import { useLockFn, useRequest } from "ahooks";
import {
  NoteContentStoreProvider,
  useNoteContents,
  writeNoteContents,
} from "@/components/state/noteContents";
import { NoteDataFetch, SyncNotesButton } from "./SyncNotesButton";
import { buttonClass } from "@/components/TopbarLayout";
import { usePeers } from "@/components/state/peers";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { getFirstSuccess } from "@/components/util";
import {
  AskPermission,
  usePermissionCache,
} from "@/components/state/permissions";
import { useUserProfile } from "@/components/state/userProfile";
import { useDeviceProfile } from "@/components/state/deviceProfile";
import { PermissionsManager } from "@/components/permissions";
import { getNetworkLayerGlobal } from "@/components/network";

export const dynamic = "force-static";

function ReconnectButton() {
  const { connected } = usePeers();

  if (connected) return null;

  return (
    <button
      className={buttonClass}
      onClick={async () => {
        const network = await getNetworkLayerGlobal();
        network.ensureInit();
      }}
    >
      Reconnect
    </button>
  );
}

function NoteContentEditor() {
  const noteText = useNoteContents((s) => s.text);
  const noteId = useNoteContents((s) => s.noteId);
  const { updateText } = useNoteContents((s) => s.cb);
  const cb = useNotesState((s) => s.cb);

  return (
    <textarea
      className="bg-black outline-none flex-grow resize-none"
      value={noteText}
      onChange={(evt) => {
        const text = evt.target.value;
        updateText(text);
        cb.updateNote(
          noteId,
          (prev) => ({
            ...prev,
            lastUpdateDate: new Date(),
            preview: text.split("\n", 1)[0].slice(0, 20),
          }),
          true,
        );
      }}
    />
  );
}

async function requestKeyForNote(noteId: string) {
  const toastId = toast.loading(`Requesting perms...`);

  const { peers } = usePeers.getState();
  const firstResult = await getFirstSuccess(
    [...peers.values()].map(async (peer) => {
      // cheating here to always get the first successful result
      // if one exists
      if (!noteId) throw new Error(``);
      const result = AskPermission.call(peer.id, {
        action: {
          actionId: [{ __typename: "Exact", value: "updateNote" }],
          resourceId: [{ __typename: "Exact", value: noteId }],
        },
      });
      for await (const { permission } of result) {
        return { peerId: peer.id, permission };
      }

      throw new Error(``);
    }),
  );

  if (!firstResult.success) {
    toast.error(`Couldn't fetch key to unlock file`, {
      id: toastId,
    });
    return false;
  }

  const { permission, peerId } = firstResult.value;

  const { permissionCache, cb } = usePermissionCache.getState();
  permissionCache.set(permission.cert.signature, permission);
  cb.updateCache(permissionCache);

  toast.success(`Successfully added permission!`);
  toast.loading(`Fetching latest data...`, {
    id: toastId,
  });

  const { notes } = useNotesState.getState();

  let count = 0;
  for (const note of notes.values()) {
    const dataFetchResult = NoteDataFetch.call(peerId, {
      noteId: note.id,
      permission,
    });

    for await (const { noteId, text } of dataFetchResult) {
      await writeNoteContents(noteId, text);

      toast.loading(`Fetching latest data... (${++count})`, {
        id: toastId,
      });
    }
  }

  toast.success(`Fetched and unlocked note!`, {
    id: toastId,
  });
}

function useNoteKeyRequest(noteId: string): {
  loading: boolean;
  requestKey: () => Promise<boolean | undefined>;
} {
  const { loading, runAsync: requestKey } = useRequest(
    async () => {
      const { userProfile } = useUserProfile.getState();
      const { deviceProfile } = useDeviceProfile.getState();
      if (!userProfile || !deviceProfile) return false;

      const { permissionCache } = usePermissionCache.getState();
      const permissions = new PermissionsManager(
        deviceProfile.id,
        userProfile?.publicAuthUserId,
        permissionCache,
      );
      const perm = permissions.findMyPermission({
        actionId: ["updateNote"],
        resourceId: [noteId],
      });

      if (perm) return true;

      await requestKeyForNote(noteId);
      return true;
    },
    {
      manual: true,
    },
  );

  const requestKeyHandler = useLockFn(requestKey);

  return {
    loading,
    requestKey: requestKeyHandler,
  };
}

export function NoteEditor({ noteId }: { noteId: string }) {
  const { userProfile } = useUserProfile();
  const { deviceProfile } = useDeviceProfile();
  const { permissionCache } = usePermissionCache();
  const {
    data: hasAuth,
    loading,
    refresh,
  } = useRequest(
    async () => {
      if (!userProfile || !deviceProfile) return false;

      const permissions = new PermissionsManager(
        deviceProfile.id,
        userProfile?.publicAuthUserId,
        permissionCache,
      );
      const perm = permissions.findMyPermission({
        actionId: ["updateNote"],
        resourceId: [noteId],
      });

      if (perm) return true;

      return false;
    },
    {
      refreshDeps: [noteId, userProfile, deviceProfile, permissionCache],
    },
  );
  const { loading: requestKeyLoading, requestKey } = useNoteKeyRequest(noteId);
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex justify-stretch relative flex-grow">
        <div className="flex grow items-center justify-center">
          <p className="text-lg font-bold">LOADING</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-stretch relative flex-grow">
      <div className="absolute top-2 right-5 flex flex-col gap-2 items-end">
        <SyncNotesButton />
        <ReconnectButton />
      </div>

      {!hasAuth ? (
        <div className="flex flex-col gap-2 grow items-center justify-center">
          <p className="text-lg">~~ LOCKED ~~</p>

          <div className="flex gap-2">
            <button
              className={buttonClass}
              disabled={requestKeyLoading}
              onClick={() => router.back()}
            >
              Go back
            </button>

            <button
              className={buttonClass}
              disabled={requestKeyLoading}
              onClick={() => requestKey().then(() => refresh())}
            >
              Request Key
            </button>
          </div>
        </div>
      ) : (
        <NoteContentStoreProvider noteId={noteId}>
          <NoteContentEditor />
        </NoteContentStoreProvider>
      )}
    </div>
  );
}

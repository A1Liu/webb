"use client";

import React from "react";
import { useNoteMetadata, useNotesState } from "@/components/state/notes";
import { useLockFn, useRequest } from "ahooks";
import {
  NoteContentStoreProvider,
  useNoteContents,
  writeNoteContents,
} from "@/components/state/noteContents";
import { NoteDataFetch, SyncNotesButton } from "./SyncNotesButton";
import { buttonClass } from "@/components/TopbarLayout";
import { RequestKeyForLock, useLocks } from "@/components/state/locks";
import { usePeers } from "@/components/state/peers";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { getFirstSuccess } from "@/components/util";

export const dynamic = "force-static";

function EnableLockingButton({ noteId }: { noteId: string }) {
  const cb = useNotesState((s) => s.cb);
  const { lockId } = useNoteMetadata(noteId);
  const {
    cb: { getLock },
  } = useLocks();
  const lock = getLock();

  if (!lock) {
    return null;
  }

  return (
    <button
      className={buttonClass}
      onClick={() =>
        cb.updateNote(noteId, (prev) => ({
          ...prev,
          lockId: lockId ? undefined : lock.id,
        }))
      }
    >
      {lockId ? "Locked" : "Unlocked"}
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

async function requestKeyForLock(lockId: string) {
  const toastId = toast.loading(`Requesting key...`);

  const { peers } = usePeers.getState();
  const firstResult = await getFirstSuccess(
    [...peers.values()].map(async (peer) => {
      // cheating here to always get the first successful result
      // if one exists
      if (!lockId) throw new Error(``);
      const result = RequestKeyForLock.call(peer.id, { lockId });
      for await (const { key } of result) {
        if (!key) continue;
        return { peerId: peer.id, key };
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

  const { key, peerId } = firstResult.value;

  const {
    cb: { addKey },
  } = useLocks.getState();
  addKey(key);

  toast.success(`Successfully added key!`);
  toast.loading(`Fetching latest data...`, {
    id: toastId,
  });

  const { notes } = useNotesState.getState();

  let count = 0;
  for (const note of notes.values()) {
    if (note.lockId !== key.lockId) continue;

    const dataFetchResult = NoteDataFetch.call(peerId, {
      noteId: note.id,
      permissionKey: key,
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

function useNoteKeyRequest(lockId?: string): {
  loading: boolean;
  requestKey: () => Promise<boolean | undefined>;
} {
  const { loading, runAsync: requestKey } = useRequest(
    async () => {
      if (!lockId) return true;
      await requestKeyForLock(lockId);
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
  const { lockId } = useNoteMetadata(noteId);
  const {
    data: hasAuth,
    loading,
    refresh,
  } = useRequest(
    async () => {
      if (!lockId) return true;
      const key = await useLocks.getState().cb.createKey(lockId);
      if (!key) return false;

      return true;
    },
    {
      refreshDeps: [lockId],
    },
  );
  const { loading: requestKeyLoading, requestKey } = useNoteKeyRequest(
    lockId ?? undefined,
  );
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
        <EnableLockingButton noteId={noteId} />
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

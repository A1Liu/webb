"use client";

import React from "react";
import { useNoteMetadata, useNotesState } from "@/components/state/notes";
import md5 from "md5";
import { useDebounceFn, useRequest } from "ahooks";
import {
  NoteContentStoreProvider,
  useNoteContents,
} from "@/components/state/noteContents";
import { SyncNotesButton } from "./SyncNotesButton";
import { buttonClass } from "@/components/TopbarLayout";
import { useLocks } from "@/components/state/locks";

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
  const { run: updateNoteHash } = useDebounceFn(
    (text: string) => {
      const hash = md5(text);
      cb.updateNote(noteId, (prev) => ({
        ...prev,
        hash,
      }));
    },
    {
      wait: 500,
      trailing: true,
    },
  );

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
        updateNoteHash(text);
      }}
    />
  );
}

export function NoteEditor({ noteId }: { noteId: string }) {
  const { lockId } = useNoteMetadata(noteId);
  const { data: hasAuth, loading } = useRequest(
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
      <div className="absolute top-2 right-2 flex flex-col gap-2 items-end">
        <SyncNotesButton />
        <EnableLockingButton noteId={noteId} />
      </div>

      {!hasAuth ? (
        <div className="flex grow items-center justify-center">
          <p className="text-lg">~~ LOCKED ~~</p>
        </div>
      ) : (
        <NoteContentStoreProvider noteId={noteId}>
          <NoteContentEditor />
        </NoteContentStoreProvider>
      )}
    </div>
  );
}

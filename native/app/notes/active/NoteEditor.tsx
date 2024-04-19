"use client";

import React from "react";
import { useNoteMetadata, useNotesState } from "@/components/state/notes";
import md5 from "md5";
import { useDebounceFn } from "ahooks";
import {
  NoteContentStoreProvider,
  useNoteContents,
} from "@/components/state/noteContents";
import { useUserProfile } from "@/components/state/userProfile";
import { SyncNotesButton } from "./SyncNotesButton";
import { buttonClass } from "@/components/TopbarLayout";
import { bytesToBase64 } from "@/components/crypto";

export const dynamic = "force-static";

function EnableLockingButton({ noteId }: { noteId: string }) {
  const cb = useNotesState((s) => s.cb);
  const hasAuth = useUserProfile((s) => !!s.userProfile?.secret);
  const { base64EncryptionIvParam } = useNoteMetadata(noteId);

  if (!hasAuth) {
    return null;
  }

  const encrypted =
    base64EncryptionIvParam?.__typename === "Lock" &&
    !!base64EncryptionIvParam.key;

  return (
    <button
      className={buttonClass}
      onClick={() =>
        cb.updateNote(noteId, (prev) => ({
          ...prev,
          base64EncryptionIvParam: encrypted
            ? { __typename: "NoLock" as const }
            : {
                __typename: "Lock" as const,
                key: bytesToBase64(
                  window.crypto.getRandomValues(new Uint8Array(12)),
                ),
              },
        }))
      }
    >
      {encrypted ? "Locked" : "Unlocked"}
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
        cb.updateNote(noteId, (prev) => ({
          ...prev,
          lastUpdateDate: new Date(),
          preview: text.split("\n", 1)[0].slice(0, 20),
        }));
        updateNoteHash(text);
      }}
    />
  );
}

export function NoteEditor({ noteId }: { noteId: string }) {
  const hasAuth = useUserProfile((s) => !!s.userProfile?.secret);
  const { base64EncryptionIvParam } = useNoteMetadata(noteId);

  return (
    <div className="flex justify-stretch relative flex-grow">
      <div className="absolute top-12 right-4 flex flex-col gap-2 items-end">
        <SyncNotesButton />
        <EnableLockingButton noteId={noteId} />
      </div>

      {!hasAuth && base64EncryptionIvParam ? (
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

"use client";

import React from "react";
import { buttonClass } from "@/components/TopbarLayout";
import { useActiveNote, useNotesState } from "@/components/state/notes";
import { useUserProfile } from "@/components/state/userProfile";
import { bytesToBase64 } from "@/components/crypto";
import { SyncNotesButton } from "./SyncNotesButton";
import { NoteEditor } from "./NoteEditor";

function EnableLockingButton({ noteId }: { noteId: string }) {
  const cb = useNotesState((s) => s.cb);
  const hasAuth = useUserProfile((s) => !!s.userProfile?.secret);
  const { base64EncryptionIvParam } = useActiveNote();

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

export function ActiveNote() {
  const hasAuth = useUserProfile((s) => !!s.userProfile?.secret);
  const { id: activeNote, base64EncryptionIvParam } = useActiveNote();

  return (
    <>
      <div className="absolute top-12 right-4 flex flex-col gap-2 items-end">
        <SyncNotesButton />
        <EnableLockingButton noteId={activeNote} />
      </div>

      {!hasAuth && base64EncryptionIvParam ? (
        <div className="flex grow items-center justify-center">
          <p className="text-lg">~~ LOCKED ~~</p>
        </div>
      ) : (
        <NoteEditor noteId={activeNote} />
      )}
    </>
  );
}

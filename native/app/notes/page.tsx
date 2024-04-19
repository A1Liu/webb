"use client";

import React from "react";
import { buttonClass, TopbarLayout } from "@/components/TopbarLayout";
import { v4 as uuid } from "uuid";
import { useActiveNote, useNotesState } from "@/components/state/notes";
import { SyncNotesButton } from "./SyncNotesButton";
import { NoteEditor } from "./NoteEditor";
import { useUserProfile } from "@/components/state/userProfile";
import { bytesToBase64 } from "@/components/crypto";

export const dynamic = "force-static";

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

function SelectActiveNote() {
  const { notes, activeNote, cb } = useNotesState();

  return (
    <select
      className="bg-slate-800"
      value={activeNote}
      onChange={(evt) => {
        cb.setActiveNote(evt.target.value);
      }}
    >
      <option key={"dummy"} value={uuid()}>
        -- New note --
      </option>

      {[...(notes ? notes?.values() : [])]
        .reverse()
        .filter((note) => !note.isTombstone)
        .map((note) => {
          return (
            <option key={note.id} value={note.id}>
              {note.merges ? "*" : ""}
              {note.preview}
            </option>
          );
        })}
    </select>
  );
}

export default function Notes() {
  const hasAuth = useUserProfile((s) => !!s.userProfile?.secret);
  const { id: activeNote, base64EncryptionIvParam } = useActiveNote();

  return (
    <TopbarLayout
      title={"Notes"}
      buttons={[
        {
          type: "link",
          text: "Settings",
          href: "/settings",
        },
        {
          type: "button",
          text: "Refresh",
          onClick: () => window.location.reload(),
        },
      ]}
    >
      <div className="absolute top-12 right-4 flex flex-col gap-2 items-end">
        <SelectActiveNote />
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
    </TopbarLayout>
  );
}

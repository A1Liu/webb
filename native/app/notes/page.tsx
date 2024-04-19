"use client";

import React from "react";
import { TopbarLayout } from "@/components/TopbarLayout";
import { v4 as uuid } from "uuid";
import { NoteData, useNotesState } from "@/components/state/notes";
import { usePlatform } from "@/components/hooks/usePlatform";
import clsx from "clsx";
import { DefaultTimeFormatter } from "@/components/util";
import { useRouter } from "next/navigation";
import { NoteEditor } from "./active/NoteEditor";
import { useLocks } from "@/components/state/locks";
import { useRequest } from "ahooks";

export const dynamic = "force-static";

function ActiveNoteButton({ note }: { note: NoteData }) {
  const cb = useNotesState((s) => s.cb);
  const activeNote = useNotesState((s) => s.activeNote);
  const { isMobile } = usePlatform();
  const { lockId } = note;
  const router = useRouter();
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

  return (
    <button
      className={clsx(
        activeNote === note.id && !isMobile ? "bg-yellow-700" : "bg-slate-700",
        "disabled:bg-slate-900",
        "text-white rounded-md p-6 flex flex-col gap-2",
      )}
      disabled={!hasAuth || loading}
      onClick={() => {
        cb.setActiveNote(note.id);
        if (isMobile) {
          router.push("/notes/active");
        }
      }}
    >
      <p>
        {note.merges ? "*" : ""}
        {note.preview}
      </p>

      <p>{DefaultTimeFormatter.format(note.lastUpdateDate)}</p>
    </button>
  );
}

function SelectActiveNote() {
  const notes = useNotesState((s) => s.notes);
  const { isMobile } = usePlatform();

  return (
    <div
      className={clsx(
        "flex flex-col gap-2 overflow-y-scroll",
        isMobile && "flex-grow",
      )}
    >
      {[...(notes ? notes?.values() : [])]
        .reverse()
        .filter((note) => !note.isTombstone)
        .map((note) => (
          <ActiveNoteButton key={note.id} note={note} />
        ))}
    </div>
  );
}

export default function Notes() {
  const { isMobile } = usePlatform();
  const activeNote = useNotesState((s) => s.activeNote);
  const cb = useNotesState((s) => s.cb);
  const router = useRouter();

  return (
    <TopbarLayout
      title={"Notes"}
      buttons={[
        {
          type: "button",
          text: "New Note",
          onClick: () => {
            cb.setActiveNote(uuid());
            if (isMobile) {
              router.push("/notes/active");
            }
          },
        },
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
      <div className="flex h-full w-full gap-2 flex-grow justify-stretch">
        <SelectActiveNote />

        {!isMobile ? (
          <div className="flex flex-col gap-2 flex-grow">
            <NoteEditor noteId={activeNote} />
          </div>
        ) : null}
      </div>
    </TopbarLayout>
  );
}

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
        !hasAuth
          ? "bg-slate-900"
          : activeNote === note.id && !isMobile
          ? "bg-yellow-700"
          : "bg-slate-700",
        "disabled:bg-slate-900",
        "text-white rounded-md p-6 flex flex-col gap-2",
      )}
      disabled={loading}
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

const desktopBoxStyles = "min-w-48 border-r border-slate-500";
function SelectActiveNote() {
  const notes = useNotesState((s) => s.notes);
  const { isMobile } = usePlatform();
  const nonTombstone = [...(notes ? notes?.values() : [])].filter(
    (note) => !note.isTombstone,
  );

  if (nonTombstone.length === 0) {
    return (
      <div
        className={clsx("flex flex-col", "items-center justify-center", {
          [desktopBoxStyles]: !isMobile,
          "flex-grow": isMobile,
        })}
      >
        <h3>No Notes</h3>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "flex flex-col",
        "gap-2 overflow-y-scroll scrollbar-hidden p-1",
        { [desktopBoxStyles]: !isMobile, "flex-grow": isMobile },
      )}
    >
      {nonTombstone.reverse().map((note) => (
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
          text: "+ Create",
          onClick: () => {
            cb.setActiveNote(uuid());
            if (isMobile) {
              router.push("/notes/active");
            }
          },
        },
        {
          type: "link",
          text: "⚙️ ",
          href: "/settings",
        },
        {
          type: "button",
          text: "😵",
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

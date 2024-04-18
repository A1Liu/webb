"use client";

import React from "react";
import { useShallow } from "zustand/react/shallow";
import { TopbarLayout } from "@/components/TopbarLayout";
import { v4 as uuid } from "uuid";
import {
  NoteContentStoreProvider,
  useNoteContents,
  useNotesState,
} from "@/components/state/notes";
import { SyncNotesButton } from "./SyncNotesButton";
import md5 from "md5";
import { useDebounceFn } from "ahooks";

export const dynamic = "force-static";

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

function NoteEditor() {
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

export default function Home() {
  const { activeNote } = useNotesState(
    useShallow((state): { activeNote: string } => {
      const id = state.activeNote ?? uuid();

      return { activeNote: id };
    }),
  );

  return (
    <TopbarLayout
      title={"Home"}
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
      <NoteContentStoreProvider noteId={activeNote}>
        <div className="absolute top-12 right-4 flex flex-col gap-2 items-end">
          <SelectActiveNote />
          <SyncNotesButton />
        </div>

        <NoteEditor />
      </NoteContentStoreProvider>
    </TopbarLayout>
  );
}

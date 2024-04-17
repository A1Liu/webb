"use client";

import React from "react";
import { useShallow } from "zustand/react/shallow";
import { TopbarLayout } from "@/components/TopbarLayout";
import { v4 as uuid } from "uuid";
import md5 from "md5";
import { useNotesState } from "@/components/state/notes";
import { SyncNotesButton } from "./SyncNotesButton";

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
              {note.text.split("\n", 1)[0].slice(0, 20)}
            </option>
          );
        })}
    </select>
  );
}

export default function Home() {
  const cb = useNotesState((s) => s.cb);
  const { text, activeNote } = useNotesState(
    useShallow((state): { activeNote: string; text: string } => {
      const id = state.activeNote ?? uuid();
      const { text } = state.notes?.get(id) ?? {
        id: uuid(),
        text: "",
        lastSyncHash: md5(""),
        lastSyncDate: new Date(),
        lastUpdateDate: new Date(),
      };

      return { activeNote: id, text };
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
      <div className="absolute top-12 right-4 flex flex-col gap-2 items-end">
        <SelectActiveNote />
        <SyncNotesButton />
      </div>

      <textarea
        className="bg-black outline-none flex-grow resize-none"
        value={text}
        onChange={(evt) => {
          cb.updateNote(activeNote, (prev) => ({
            ...prev,
            text: evt.target.value,
            lastUpdateDate: new Date(),
          }));
        }}
      />
    </TopbarLayout>
  );
}

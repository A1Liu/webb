"use client";

import React from "react";
import { TopbarLayout } from "@/components/TopbarLayout";
import { useModifyGlobals, usePersistedState } from "@/components/globals";
import { v4 as uuid } from "uuid";
import md5 from "md5";
import { useDebounceFn } from "ahooks";

export const dynamic = "force-static";

function SelectActiveNote() {
  const cb = useModifyGlobals();
  const notes = usePersistedState((state) => state.notes);
  const activeNote = usePersistedState((state) => state.activeNote);

  return (
    <select
      className="bg-slate-800"
      value={activeNote}
      onChange={(evt) => {
        cb.setActiveNote(evt.target.value);
      }}
    >
      <option key={"dummy"} value={undefined}>
        -- New note --
      </option>

      {[...(notes ? notes?.values() : [])].map((note) => {
        return (
          <option key={note.id} value={note.id}>
            {note.text.split("\n", 1)[0]}
          </option>
        );
      })}
    </select>
  );
}

export default function Home() {
  const cb = useModifyGlobals();
  const note = usePersistedState(
    (state) =>
      state.notes?.get(state.activeNote ?? "") ?? {
        id: uuid(),
        hash: md5(""),
        text: "",
        date: new Date(),
      },
  );

  const { run: updateHash } = useDebounceFn(
    (id: string, text: string) => {
      cb.updateNote({
        id,
        date: new Date(),
        text,
        hash: md5(text),
      });
    },
    {
      trailing: true,
      wait: 500,
    },
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
      <div className="absolute top-12 right-6">
        <SelectActiveNote />
      </div>

      <textarea
        className="bg-black outline-none flex-grow resize-none"
        value={note.text}
        onChange={(evt) => {
          cb.updateNote({
            ...note,
            text: evt.target.value,
            date: new Date(),
          });
          cb.setActiveNote(note.id);
          updateHash(note.id, evt.target.value);
        }}
      />
    </TopbarLayout>
  );
}

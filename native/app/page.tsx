"use client";

import React from "react";
import { TopbarLayout } from "@/components/TopbarLayout";
import { useModifyGlobals, usePersistedState } from "@/components/globals";
import { v4 as uuid } from "uuid";
import md5 from "md5";
import { useDebounceFn } from "ahooks";

export const dynamic = "force-static";

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

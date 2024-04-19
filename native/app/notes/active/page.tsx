"use client";

import React from "react";
import { TopbarLayout } from "@/components/TopbarLayout";
import { useActiveNote } from "@/components/state/notes";
import { NoteEditor } from "./NoteEditor";

export const dynamic = "force-static";

export default function Notes() {
  const { id, preview } = useActiveNote();
  return (
    <TopbarLayout
      title={preview}
      buttons={[
        {
          type: "link",
          text: "View All",
          href: "/notes",
        },
        {
          type: "button",
          text: "Refresh",
          onClick: () => window.location.reload(),
        },
      ]}
    >
      <NoteEditor noteId={id} />
    </TopbarLayout>
  );
}

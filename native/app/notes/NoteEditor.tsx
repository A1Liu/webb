"use client";

import React from "react";
import { useNotesState } from "@/components/state/notes";
import md5 from "md5";
import { useDebounceFn } from "ahooks";
import {
  NoteContentStoreProvider,
  useNoteContents,
} from "@/components/state/noteContents";

export const dynamic = "force-static";

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
  return (
    <NoteContentStoreProvider noteId={noteId}>
      <NoteContentEditor />
    </NoteContentStoreProvider>
  );
}

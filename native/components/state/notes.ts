"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import md5 from "md5";
import { ZustandJsonStorage } from "../util";
import { InitGroup } from "../constants";

export type NoteData = z.infer<typeof NoteDataSchema> & {
  // TODO: probably need to save where the merges came from as well
  merges?: z.infer<typeof NoteDataSchema>[];
};
export const NoteDataSchema = z.object({
  id: z.string(),
  text: z.string(),
  isTombstone: z.boolean().optional(),
  lastUpdateDate: z.coerce.date(),
  lastSyncDate: z.coerce.date(),
  lastSyncHash: z.string(),
});

export interface NoteGlobalState {
  activeNote: string;
  notes: Map<string, NoteData>;

  cb: {
    updateNote: (id: string, updater: (prev: NoteData) => NoteData) => void;
    updateNotesFromSync: (notes: NoteData[]) => void;
    setActiveNote: (id: string) => void;
  };
}

export const useNotesState = create<NoteGlobalState>()(
  persist(
    (set) => {
      return {
        activeNote: uuid(),
        notes: new Map(),
        cb: {
          updateNote: (noteId, updater) => {
            set((prev) => {
              const notes = new Map(prev.notes);
              const now = new Date();
              const prevNote: NoteData = notes.get(noteId) ?? {
                id: noteId,
                text: "",
                lastUpdateDate: now,
                lastSyncDate: now,
                lastSyncHash: md5(""),
              };

              notes.delete(noteId);
              notes.set(noteId, updater(prevNote));

              return { notes };
            });
          },

          updateNotesFromSync: (newNotes) => {
            set((prev) => {
              const mutableNotesMap = new Map(prev.notes);
              for (const newNote of newNotes) {
                if (!newNote.isTombstone) {
                  mutableNotesMap.set(newNote.id, newNote);
                }

                const prevNote = prev.notes?.get(newNote.id);
                if (!prevNote) continue;

                if (prevNote.isTombstone) {
                  mutableNotesMap.delete(newNote.id);
                  continue;
                }

                mutableNotesMap.set(newNote.id, newNote);
              }

              const notes = new Map(
                [...mutableNotesMap.entries()].sort((l, r) => {
                  return (
                    l[1].lastUpdateDate.getTime() -
                    r[1].lastUpdateDate.getTime()
                  );
                }),
              );

              return { notes };
            });
          },

          setActiveNote: (id) =>
            set((prev) => {
              if (prev.activeNote === id) {
                return prev;
              }
              const prevActive = prev.notes?.get(prev.activeNote ?? "");
              if (prevActive && (!prevActive.text || prevActive.isTombstone)) {
                const notes = new Map(prev.notes);
                notes.set(prevActive.id, {
                  ...prevActive,
                  isTombstone: true,
                });

                return { activeNote: id, notes };
              }

              return { activeNote: id };
            }),
        },
      };
    },
    {
      name: "webb-note-storage",
      storage: ZustandJsonStorage,
      skipHydration: true,
      partialize: ({ cb, ...data }) => ({ ...data }),
    },
  ),
);

export const NotesSyncInitGroup = new InitGroup("notesSync");

NotesSyncInitGroup.registerValue({
  field: "useNotesState",
  eagerInit: true,
  create: () => {
    // Manually call rehydrate on startup to work around SSR nonsense
    // in Next.js
    useNotesState.persist.rehydrate();

    return useNotesState;
  },
});

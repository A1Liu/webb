"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import md5 from "md5";
import { ZustandIdbStorage } from "../util";
import { InitGroup } from "../constants";

const NoteDataSchemaInternal = z.object({
  id: z.string(),
  preview: z.string(),
  hash: z.string(),
  base64EncryptionIvParam: z.string().nullish(),
  isTombstone: z.boolean().optional(),
  lastUpdateDate: z.coerce.date(),
  lastSyncDate: z.coerce.date(),
  lastSyncHash: z.string(),
});

export type NoteData = z.infer<typeof NoteDataSchema>;
export const NoteDataSchema = NoteDataSchemaInternal.extend({
  merges: NoteDataSchemaInternal.array().nullish(),
});

export interface NoteGlobalState {
  activeNote: string;
  notes: Map<string, NoteData>;

  cb: {
    updateNote: (id: string, updater: (prev: NoteData) => NoteData) => void;
    updateNotesFromSync: (notes: NoteData[]) => { contentsChanged: NoteData[] };
    setActiveNote: (id: string) => void;
  };
}

export const useNotesState = create<NoteGlobalState>()(
  persist(
    (set, get) => {
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
                hash: md5(""),
                preview: "",
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
            const prev = get();
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
                  l[1].lastUpdateDate.getTime() - r[1].lastUpdateDate.getTime()
                );
              }),
            );

            set({ notes });

            return {
              contentsChanged: newNotes.filter((note) => {
                const prevNote = prev.notes.get(note.id);
                if (!prevNote) return true;

                if (prevNote.hash !== note.hash) return true;

                return false;
              }),
            };
          },

          setActiveNote: (id) =>
            set((prev) => {
              if (prev.activeNote === id) {
                return prev;
              }
              const prevActive = prev.notes?.get(prev.activeNote ?? "");
              if (prevActive && prevActive.hash === md5("")) {
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
      storage: ZustandIdbStorage,
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

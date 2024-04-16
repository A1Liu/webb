import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import md5 from "md5";
import { ZustandJsonStorage } from "../util";

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
    updateNoteFromSync: (note: NoteData) => void;
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
              const notes = new Map(prev.notes ?? []);
              const now = new Date();
              const prevNote: NoteData = notes.get(noteId) ?? {
                id: noteId,
                text: "",
                lastUpdateDate: now,
                lastSyncDate: now,
                lastSyncHash: md5(""),
              };

              notes.set(noteId, updater(prevNote));

              return { notes };
            });
          },
          updateNoteFromSync: (note: NoteData) => {
            set((prev) => {
              if (!note.isTombstone) {
                const notes = new Map(prev.notes ?? []);
                notes.set(note.id, note);
                return { notes };
              }

              const prevNote = prev.notes?.get(note.id);
              if (!prevNote) return prev;

              const notes = new Map(prev.notes ?? []);

              if (prevNote.isTombstone) {
                notes.delete(note.id);
                return { notes };
              }

              notes.set(note.id, note);
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

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { InitGroup } from "../constants";
import { ZustandIdbStorage } from "../util";

const NoteDataSchemaInternal = z
  .object({
    id: z.string(),
    preview: z.string(),
    isTombstone: z.boolean().nullish(),
    commitHeads: z.string().array().readonly().default([]),
    lastUpdateDate: z.coerce.date(),
  })
  .readonly();

export type NoteData = z.infer<typeof NoteDataSchema>;
export const NoteDataSchema = NoteDataSchemaInternal;

export interface NoteGlobalState {
  activeNote: string;
  notes: Map<string, NoteData>;

  cb: {
    updateNote: (
      id: string,
      updater: (prev: NoteData) => NoteData,
      reoder?: boolean,
    ) => void;
    updateNotesFromSync: (notes: NoteData[]) => void;
    setActiveNote: (id: string) => void;
  };
}

const ZERO_TIME = new Date(0);

function createEmptyNote(id: string): NoteData {
  return {
    id,
    preview: "",
    commitHeads: [],
    lastUpdateDate: ZERO_TIME,
  };
}

export const useNotesState = create<NoteGlobalState>()(
  persist(
    (set, get) => {
      return {
        activeNote: uuid(),
        notes: new Map(),
        cb: {
          updateNote: (noteId, updater, reorder = false) => {
            set((prev) => {
              const notes = new Map(prev.notes);
              const prevNote: NoteData =
                notes.get(noteId) ?? createEmptyNote(noteId);

              const newNote = updater(prevNote);

              if (reorder) {
                notes.delete(noteId);
              }
              notes.set(noteId, newNote);

              return { notes };
            });
          },

          updateNotesFromSync: (newNotes) => {
            const prev = get();
            const mutableNotesMap = new Map(prev.notes);
            for (const newNote of newNotes) {
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
          },
          setActiveNote: (id) =>
            set((prev) => {
              if (prev.activeNote === id) {
                return prev;
              }

              const prevActive = prev.notes.get(prev.activeNote ?? "");
              if (prevActive && prevActive.preview === "") {
                const notes = new Map(prev.notes);
                notes.set(prevActive.id, {
                  ...prevActive,
                  commitHeads: [],
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

export function useNoteMetadata(noteId: string): NoteData {
  return useNotesState(
    useShallow((state) => state.notes.get(noteId) ?? createEmptyNote(noteId)),
  );
}

const selector = (state: NoteGlobalState) =>
  state.notes.get(state.activeNote) ?? createEmptyNote(state.activeNote);
export function useActiveNote(): NoteData {
  return useNotesState(useShallow(selector));
}

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

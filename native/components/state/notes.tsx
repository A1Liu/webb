import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { InitGroup } from "../constants";
import { ZustandIdbStorage } from "../util";

const NoteDataSchemaInternal = z.object({
  id: z.string(),
  preview: z.string(),
  isTombstone: z.boolean().nullish(),
  md5ContentHash: z.string().nullish(),
  lastUpdateDate: z.coerce.date(),
});

export type NoteData = z.infer<typeof NoteDataSchema>;
export const NoteDataSchema = NoteDataSchemaInternal.extend({
  merges: NoteDataSchemaInternal.array().nullish(),
});

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
    killHash: (noteId: string) => void;
    updateHash: (noteId: string, getHash: () => string) => void;
  };
}

const ZERO_TIME = new Date(0);

function createEmptyNote(id: string): NoteData {
  return {
    id,
    preview: "",
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
          killHash: (noteId) => {
            const { notes } = get();
            const note = notes.get(noteId);
            if (!note) return;
            if (note.md5ContentHash === undefined) return;

            const newNotes = new Map(notes);
            newNotes.set(noteId, {
              ...note,
              md5ContentHash: undefined,
            });

            set({ notes: newNotes });
          },
          updateHash: (noteId, getHash) => {
            const { notes } = get();
            const note = notes.get(noteId);
            if (!note) return;

            // If we already have a hash, we assume it's valid.
            if (note.md5ContentHash) return;

            const newNotes = new Map(notes);
            newNotes.set(noteId, {
              ...note,
              md5ContentHash: getHash(),
            });

            set({ notes: newNotes });
          },
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

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { InitGroup } from "../constants";
import { ZustandIdbStorage } from "../util";
import { useCreation } from "ahooks";

const NoteDataSchemaInternal = z.object({
  id: z.string(),
  folder: z.string().array().default([]),
  preview: z.string(),
  isTombstone: z.boolean().nullish(),
  commitHeads: z.string().array().readonly().default([]),
  lastUpdateDate: z.coerce.date(),
});

export type NoteData = z.infer<typeof NoteDataSchema>;
export const NoteDataSchema = NoteDataSchemaInternal;

export interface NoteGlobalState {
  notes: Map<string, Readonly<NoteData>>;

  activeNote: string;
  currentFolder: string[];
  createNoteDefaultFolder?: string;
  hideDisallowedFolders?: boolean;

  cb: {
    setCurrentFolder: (path: string[]) => void;
    setHidePreference: (pref: boolean) => void;
    setDefaultFolder: (pref: string) => void;
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

function createEmptyNote(id: string, folder: string[]): NoteData {
  return {
    id,
    folder: folder,
    preview: "",
    commitHeads: [],
    lastUpdateDate: ZERO_TIME,
  };
}

export const useNotesState = create<NoteGlobalState>()(
  persist(
    (set, get) => {
      return {
        notes: new Map(),

        activeNote: uuid(),
        currentFolder: [],

        cb: {
          setCurrentFolder: (path) => {
            set({ currentFolder: path });
          },

          setHidePreference: (pref) => {
            set({ hideDisallowedFolders: pref });
          },
          setDefaultFolder: (pref) => {
            set({ createNoteDefaultFolder: pref });
          },
          updateNote: (noteId, updater, reorder = false) => {
            set((prev) => {
              const notes = new Map(prev.notes);
              const prevNote: NoteData =
                notes.get(noteId) ??
                createEmptyNote(noteId, prev.currentFolder);

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
  const path = useNotesState((state) => state.currentFolder);
  const defaultNote = useCreation(
    () => createEmptyNote(noteId, path),
    [noteId, path],
  );
  return useNotesState(
    useShallow((state) => state.notes.get(noteId) ?? defaultNote),
  );
}

const selector = (state: NoteGlobalState) =>
  state.notes.get(state.activeNote) ??
  createEmptyNote(state.activeNote, state.currentFolder);
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

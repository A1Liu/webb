"use client";

import { create, createStore, StoreApi, useStore } from "zustand";
import { persist, StorageValue } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import md5 from "md5";
import { ZustandIdbStorage } from "../util";
import { InitGroup } from "../constants";
import { createContext, useContext, useEffect } from "react";
import { useCreation } from "ahooks";
import { get, set } from "idb-keyval";
import { getOrCompute } from "@/../ui-shared/dist/util";
import toast from "react-hot-toast";

export const NoteDateSchemaOld = z.object({
  id: z.string(), // TODO: make this simpler
  text: z.string(),
  isTombstone: z.boolean().optional(),
  lastUpdateDate: z.coerce.date(),
  lastSyncDate: z.coerce.date(),
  lastSyncHash: z.string(),
});

const NoteDateSchemaInternal = z.object({
  id: z.string(),
  preview: z.string(),
  hash: z.string(),
  isTombstone: z.boolean().optional(),
  lastUpdateDate: z.coerce.date(),
  lastSyncDate: z.coerce.date(),
  lastSyncHash: z.string(),
});

export type NoteData = z.infer<typeof NoteDataSchema>;
export const NoteDataSchema = NoteDateSchemaInternal.extend({
  merges: NoteDateSchemaInternal.array().nullish(),
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

export type NoteContents = z.infer<typeof NoteContentsSchema>;
export const NoteContentsSchema = z.object({
  __typename: z.literal("CleartextNote"),
  noteId: z.string(),
  text: z.string(),
});

interface NoteContentState extends NoteContents {
  cb: {
    updateText: (s: string) => void;
  };
}

const globalStoreRegistry = new Map<
  string,
  { refCount: number; store: ReturnType<typeof createNoteContentStore> }
>();

const VERSION = 0;

export async function writeNoteContents(noteId: string, text: string) {
  const runningStore = globalStoreRegistry.get(noteId);
  if (runningStore) {
    runningStore.store.setState({ text });
    return;
  }

  const value: StorageValue<NoteContents> = {
    state: {
      __typename: "CleartextNote",
      noteId,
      text,
    },
    version: VERSION,
  };
  await set(`webb-note-contents-${noteId}`, value);
}
export async function readNoteContents(
  noteId: string,
): Promise<string | undefined> {
  const value = await get<StorageValue<NoteContents>>(
    `webb-note-contents-${noteId}`,
  );
  return value?.state.text;
}

function createNoteContentStore(noteId: string) {
  return createStore<NoteContentState>()(
    persist(
      (set) => ({
        __typename: "CleartextNote",
        noteId,
        text: "",
        cb: {
          updateText: (text) => {
            set({ text });
          },
        },
      }),
      {
        name: `webb-note-contents-${noteId}`,
        storage: ZustandIdbStorage,
        version: VERSION,
        skipHydration: true,
        partialize: ({ cb, ...rest }) => ({ ...rest }),
      },
    ),
  );
}

export const NoteContentContext =
  createContext<StoreApi<NoteContentState> | null>(null);

export interface NoteContentStoreProviderProps {
  noteId: string;
  children: React.ReactNode;
}

export const NoteContentStoreProvider = ({
  noteId,
  children,
}: NoteContentStoreProviderProps) => {
  const store = useCreation(() => {
    const storeRef = getOrCompute(globalStoreRegistry, noteId, () => ({
      refCount: 0,
      store: createNoteContentStore(noteId),
    }));
    storeRef.refCount += 1;
    return storeRef.store;
  }, [noteId]);

  useEffect(() => {
    store.persist.rehydrate();
    return () => {
      const storeRef = globalStoreRegistry.get(noteId);
      if (!storeRef) {
        console.error(`storeRef didn't exist during cleanup`);
        toast.error(`weird behavior in notes content store`);
        return;
      }

      storeRef.refCount -= 1;
      if (storeRef.refCount <= 0) {
        globalStoreRegistry.delete(noteId);
      }
    };
  }, [store, noteId]);

  return (
    <NoteContentContext.Provider value={store}>
      {children}
    </NoteContentContext.Provider>
  );
};

export function useNoteContents<T>(
  selector: (store: NoteContentState) => T,
): T {
  const noteContentContext = useContext(NoteContentContext);

  if (!noteContentContext) {
    throw new Error(
      `useNoteContents must be use within NoteContentStoreProvider`,
    );
  }

  return useStore(noteContentContext, selector);
}

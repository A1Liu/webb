"use client";

import { createStore, StoreApi, useStore } from "zustand";
import { persist, StorageValue } from "zustand/middleware";
import { z } from "zod";
import { ZustandIdbStorage } from "../util";
import { createContext, useContext, useEffect } from "react";
import { useCreation } from "ahooks";
import { get, set } from "idb-keyval";
import { getOrCompute } from "@a1liu/webb-ui-shared/util";

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
        // Not sure how this would happen.
        console.error(`storeRef didn't exist during cleanup`);
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

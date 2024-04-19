"use client";

import { createStore, StoreApi, useStore } from "zustand";
import { persist, StorageValue } from "zustand/middleware";
import { z } from "zod";
import { ZustandIdbStorage } from "../util";
import { createContext, useContext, useEffect } from "react";
import { del, get, set } from "idb-keyval";
import { useCreation } from "ahooks";

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

// TODO: support multiple
const runningEditor: {
  current?: ReturnType<typeof createNoteContentStore>;
} = {};

const VERSION = 0;

export async function deleteNoteContents(noteId: string) {
  if (runningEditor.current?.getState().noteId === noteId) {
    runningEditor.current.setState({ text: "" });
    runningEditor.current.persist.clearStorage();
    return;
  }

  await del(`webb-note-contents-${noteId}`);
}

export async function writeNoteContents(noteId: string, text: string) {
  if (runningEditor.current?.getState().noteId === noteId) {
    runningEditor.current.setState({ text });
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
    return createNoteContentStore(noteId);
  }, [noteId]);

  useEffect(() => {
    store.persist.rehydrate();
    runningEditor.current = store;

    return () => {
      if (store === runningEditor.current) {
        runningEditor.current = undefined;
      }
    };
  }, [store]);

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

"use client";

import { createStore, StoreApi, useStore } from "zustand";
import { persist, StorageValue } from "zustand/middleware";
import { z } from "zod";
import { ZustandIdbStorage } from "../util";
import { createContext, useContext, useEffect } from "react";
import { useCreation } from "ahooks";
import { GlobalInitGroup } from "../constants";
import { debounce } from "lodash";
import md5 from "md5";

export const EMPTY_HASH = md5("");

export const useNoteHashStore = createStore<{
  hashes: Map<string, string>;
  setHash: (noteId: string, hash: string) => void;
}>()(
  persist(
    (set) => {
      return {
        hashes: new Map(),
        setHash: (noteId, hash) => {
          set(({ hashes }) => {
            const newHashes = new Map(hashes);
            newHashes.set(noteId, hash);

            return {
              hashes: newHashes,
            };
          });
        },
      };
    },
    {
      name: "webb-note-hashes",
      storage: ZustandIdbStorage,
      skipHydration: true,
      partialize: ({ setHash, ...rest }) => ({ ...rest }),
    },
  ),
);

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

function getIdbKey(noteId: string) {
  return `webb-note-contents-${noteId}`;
}

export async function deleteNoteContents(noteId: string) {
  if (runningEditor.current?.getState().noteId === noteId) {
    runningEditor.current.getState().cb.updateText("");
    runningEditor.current.persist.clearStorage();
    return;
  }

  await ZustandIdbStorage.removeItem(getIdbKey(noteId));
}

export async function writeNoteContents(noteId: string, text: string) {
  if (runningEditor.current?.getState().noteId === noteId) {
    runningEditor.current.getState().cb.updateText(text);
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

  await ZustandIdbStorage.setItem(getIdbKey(noteId), value);
  useNoteHashStore.getState().setHash(noteId, md5(text));
}

export async function readNoteContents(
  noteId: string,
): Promise<string | undefined> {
  const output = await ZustandIdbStorage.getItem(getIdbKey(noteId));

  const state = output?.state as NoteContents;

  return state.text;
}

function createNoteContentStore(noteId: string) {
  const { setHash } = useNoteHashStore.getState();
  const updateHash = debounce(
    (text: string) => {
      const hash = md5(text);
      setHash(noteId, hash);
    },
    500,
    { trailing: true },
  );

  return createStore<NoteContentState>()(
    persist(
      (set) => ({
        __typename: "CleartextNote",
        noteId,
        text: "",
        cb: {
          updateText: (text) => {
            set({ text });
            updateHash(text);
          },
        },
      }),
      {
        name: getIdbKey(noteId),
        storage: ZustandIdbStorage,
        version: VERSION,
        skipHydration: true,
        partialize: ({ cb, ...rest }) => ({ ...rest }),
        onRehydrateStorage: (_prevState) => {
          return (newState) => {
            if (newState) {
              updateHash(newState.text);
            }
          };
        },
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

GlobalInitGroup.registerValue({
  field: "noteHashes",
  eagerInit: true,
  create: () => {
    useNoteHashStore.persist.rehydrate();
  },
});

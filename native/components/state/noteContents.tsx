"use client";

import { createStore, StoreApi, useStore } from "zustand";
import { persist, PersistStorage, StorageValue } from "zustand/middleware";
import { base64ToBytes, bytesToBase64, ZustandIdbStorage } from "../util";
import { createContext, useContext, useEffect } from "react";
import { useCreation } from "ahooks";
import toast from "react-hot-toast";
import * as automerge from "@automerge/automerge";

interface NoteContentsSerialized {
  noteId: string;
  doc: string;
}

interface NoteContentState {
  noteId: string;
  doc: automerge.next.Doc<{ contents: string }>;
  actions: {
    updateText: (s: string) => void;
    overwriteTextNoHistory: (s: string) => void;
    applyChanges: (s: Uint8Array[]) => void;
  };
}

// TODO: support multiple
const runningEditor: {
  current?: ReturnType<typeof createNoteContentStore>;
} = {};

const VERSION = 0;

function getIdbKey(noteId: string) {
  return `webb-note-content-data-${noteId}`;
}

export async function deleteNoteContents(noteId: string) {
  if (runningEditor.current?.getState().noteId === noteId) {
    runningEditor.current.getState().actions.updateText("");
    runningEditor.current.persist.clearStorage();
    return;
  }

  await ZustandIdbStorage.removeItem(getIdbKey(noteId));
}

const ZustandIdbNotesStorage: PersistStorage<
  Omit<NoteContentState, "actions">
> = {
  setItem: async (key, value) => {
    const serializeValue: StorageValue<NoteContentsSerialized> = {
      state: {
        noteId: value.state.noteId,
        doc: bytesToBase64(automerge.save(value.state.doc)),
      },
      version: VERSION,
    };

    await ZustandIdbStorage.setItem(key, serializeValue);
  },
  getItem: async (key) => {
    const output = await ZustandIdbStorage.getItem(key);
    if (!output) {
      return null;
    }

    const state = output.state as NoteContentsSerialized;

    const doc = automerge.load<NoteContentState["doc"]>(
      new Uint8Array(base64ToBytes(state.doc)),
    );

    return {
      state: {
        noteId: state.noteId,
        doc,
      },
      version: 0,
    };
  },
  removeItem: async (key) => {
    await ZustandIdbStorage.removeItem(key);
  },
};

export async function writeNoteContents(noteId: string, text: string) {
  if (runningEditor.current?.getState().noteId === noteId) {
    toast(`writing to current contents`);
    runningEditor.current.getState().actions.updateText(text);
    return;
  }

  const doc = automerge.from({ contents: text });

  const value: StorageValue<NoteContentsSerialized> = {
    state: {
      noteId,
      doc: bytesToBase64(automerge.save(doc)),
    },
    version: VERSION,
  };

  await ZustandIdbStorage.setItem(getIdbKey(noteId), value);
}

export async function readNoteContents(
  noteId: string,
): Promise<string | undefined> {
  const output = await ZustandIdbStorage.getItem(getIdbKey(noteId));
  if (!output) {
    return undefined;
  }

  const state = output.state as NoteContentsSerialized;

  return automerge.load<NoteContentState["doc"]>(
    new Uint8Array(base64ToBytes(state.doc)),
  ).contents;
}

function createNoteContentStore(noteId: string) {
  return createStore<NoteContentState>()(
    persist(
      (set, get) => ({
        noteId,
        doc: automerge.from({ contents: "" }),
        actions: {
          applyChanges: (changes) => {
            const { doc } = get();
            const [newDoc] = automerge.applyChanges<{ contents: string }>(
              doc,
              changes,
            );
            set({ doc: newDoc });
          },
          overwriteTextNoHistory: (contents) => {
            const doc = automerge.from({ contents });
            set({ doc });
          },
          updateText: (text) => {
            const { doc } = get();
            const newDoc = automerge.change(doc, (d) => {
              automerge.next.updateText(d, ["contents"], text);
            });
            set({ doc: newDoc });
          },
        },
      }),
      {
        name: getIdbKey(noteId),
        storage: ZustandIdbNotesStorage,
        version: VERSION,
        skipHydration: true,
        partialize: ({ actions, ...rest }) => ({ ...rest }),
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

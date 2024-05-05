"use client";

import { createStore, StoreApi, useStore } from "zustand";
import { persist, PersistStorage, StorageValue } from "zustand/middleware";
import { base64ToBytes, bytesToBase64, ZustandIdbStorage } from "../util";
import { createContext, useContext, useEffect } from "react";
import { useCreation } from "ahooks";
import toast from "react-hot-toast";
import type * as automerge from "@automerge/automerge";
import { Future } from "@/../ui-shared/dist/util";

export const automergePackage = Future.unwrapPromise(
  import("@automerge/automerge"),
);

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

  await ZustandIdbNotesStorage.removeItem(noteId);
}

export const ZustandIdbNotesStorage: PersistStorage<
  Omit<NoteContentState, "actions">
> = {
  setItem: async (id, value) => {
    const automerge = await automergePackage.promise;

    const serializeValue: StorageValue<NoteContentsSerialized> = {
      state: {
        noteId: value.state.noteId,
        doc: bytesToBase64(automerge.save(value.state.doc)),
      },
      version: VERSION,
    };

    await ZustandIdbStorage.setItem(getIdbKey(id), serializeValue);
  },
  getItem: async (id) => {
    const automerge = await automergePackage.promise;

    const output = await ZustandIdbStorage.getItem(getIdbKey(id));
    if (!output) {
      return null;
    }

    const state = output.state as NoteContentsSerialized;

    const doc = automerge.load<NoteContentState["doc"]>(
      new Uint8Array(base64ToBytes(state.doc)),
    );

    return {
      version: VERSION,
      state: {
        noteId: state.noteId,
        doc,
      },
    };
  },
  removeItem: async (id) => {
    await ZustandIdbStorage.removeItem(getIdbKey(id));
  },
};

export async function updateNoteDoc(
  noteId: string,
  doc: automerge.next.Doc<{ contents: string }>,
) {
  if (runningEditor.current?.getState().noteId === noteId) {
    toast(`writing to current contents`);
    runningEditor.current.setState({ doc });
    return;
  }

  await ZustandIdbNotesStorage.setItem(noteId, {
    version: VERSION,
    state: {
      noteId,
      doc,
    },
  });
}

function createNoteContentStore(noteId: string) {
  const automerge = automergePackage.value!;
  return createStore<NoteContentState>()(
    persist(
      (set, get) => ({
        noteId,
        doc: automerge.from({ contents: "New Note" })!,
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
            console.log(doc);
            const newDoc = automerge.change(doc, (d) => {
              console.log("before", d, d.contents);
              automerge.next.updateText(d, ["contents"], text);
              console.log("after", d);
            });
            set({ doc: newDoc });
          },
        },
      }),
      {
        name: noteId,
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

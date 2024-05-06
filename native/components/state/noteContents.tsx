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
  doc: automerge.next.Doc<{ contents: automerge.Text }>;
  actions: {
    overwriteTextNoHistory: (s: string) => void;
    applyChanges: (s: Uint8Array[]) => void;
    changeDoc: (updater: (d: { contents: automerge.Text }) => void) => void;
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
    runningEditor.current.getState().actions.overwriteTextNoHistory("");
    runningEditor.current.persist.clearStorage();
  }

  await ZustandIdbNotesStorage.removeItem(noteId);
}

export const ZustandIdbNotesStorage: PersistStorage<
  Omit<NoteContentState, "actions">
> = {
  setItem: async (id, value) => {
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
  doc: automerge.next.Doc<{ contents: automerge.Text }>,
) {
  if (runningEditor.current?.getState().noteId === noteId) {
    toast(`writing to current contents`);
    runningEditor.current.setState({ doc });
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
  return createStore<NoteContentState>()(
    persist(
      (set, get) => ({
        noteId,
        doc: automerge.from({ contents: new automerge.Text("") })!,
        actions: {
          changeDoc: (updater) => {
            const { doc } = get();
            const newDoc = automerge.change(doc, (d) => {
              updater(d);
            });
            console.log(newDoc.contents);
            set({ doc: newDoc });
          },
          applyChanges: (changes) => {
            const { doc } = get();
            const [newDoc] = automerge.applyChanges<{
              contents: automerge.Text;
            }>(doc, changes);
            set({ doc: newDoc });
          },
          overwriteTextNoHistory: (contents) => {
            const doc = automerge.from({
              contents: new automerge.Text(contents),
            });
            set({ doc });
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

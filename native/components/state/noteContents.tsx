import { createStore, StoreApi, useStore } from "zustand";
import { persist, PersistStorage, StorageValue } from "zustand/middleware";
import { base64ToBytes, bytesToBase64, ZustandIdbStorage } from "../util";
import { createContext, useContext, useEffect } from "react";
import { useCreation } from "ahooks";
import toast from "react-hot-toast";
import * as automerge from "@automerge/automerge";
import { useNotesState } from "./notes";
import { Future } from "@a1liu/webb-tools/util";

interface NoteContentsSerialized {
  noteId: string;
  doc: string;
}

export type NoteDocData = { contents: automerge.Text };
export type NoteDoc = automerge.Doc<NoteDocData>;
interface NoteContentState {
  noteId: string;
  doc: NoteDoc;
  hydrationPromise: Future<true>;
  actions: {
    overwriteTextNoHistory: (s: string) => void;
    applyChanges: (s: Uint8Array[]) => void;
    changeDoc: (updater: (d: NoteDocData) => void) => void;
  };
}

// TODO: support multiple
const editorRef: { current?: ReturnType<typeof createNoteContentStore> } = {};
const AUTOMERGE_ACTOR = "60b965cef36a4894aa53fb8cd00e7685";
const VERSION = 0;

function getIdbKey(noteId: string) {
  return `webb-note-content-data-${noteId}`;
}

export async function deleteNoteContents(noteId: string) {
  if (editorRef.current?.getState().noteId === noteId) {
    editorRef.current.getState().actions.overwriteTextNoHistory("");
    editorRef.current.persist.clearStorage();
  }

  await ZustandIdbNotesStorage.removeItem(noteId);
}

export const ZustandIdbNotesStorage: PersistStorage<
  Omit<NoteContentState, "actions" | "hydrationPromise">
> = {
  setItem: async (id, value) => {
    useNotesState.getState().cb.updateNote(id, (prev) => ({
      ...prev,
      commitHeads: automerge.getHeads(value.state.doc),
    }));
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

    const doc = automerge.load<NoteDoc>(
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

export async function updateNoteDocAsync(
  noteId: string,
  docInput: NoteDoc | string,
) {
  const doc =
    typeof docInput === "string"
      ? automerge.from(
          { contents: new automerge.Text(docInput) },
          { actor: AUTOMERGE_ACTOR },
        )
      : docInput;
  if (editorRef.current?.getState().noteId === noteId) {
    toast(`writing to current contents`);
    editorRef.current.setState({ doc });
  }

  const setItemPromise = ZustandIdbNotesStorage.setItem(noteId, {
    version: VERSION,
    state: { noteId, doc },
  });

  await setItemPromise;
}

function createNoteContentStore(noteId: string) {
  return createStore<NoteContentState>()(
    persist(
      (set, get) => {
        const hydrationPromise = new Future<true>();
        return {
          noteId,
          hydrationPromise,
          doc: automerge.from(
            { contents: new automerge.Text("") },
            { actor: AUTOMERGE_ACTOR },
          ),
          actions: {
            changeDoc: (updater) => {
              const { doc } = get();
              const newDoc = automerge.change(doc, updater);
              set({ doc: newDoc });
            },
            applyChanges: (changes) => {
              const { doc } = get();
              const [newDoc] = automerge.applyChanges<NoteDocData>(
                doc,
                changes,
              );
              set({ doc: newDoc });
            },
            overwriteTextNoHistory: (contents) => {
              const doc = automerge.from(
                { contents: new automerge.Text(contents) },
                { actor: AUTOMERGE_ACTOR },
              );
              set({ doc });
            },
          },
        };
      },
      {
        name: noteId,
        storage: ZustandIdbNotesStorage,
        version: VERSION,
        skipHydration: true,
        partialize: ({ actions, hydrationPromise, ...rest }) => ({ ...rest }),
        onRehydrateStorage: ({ hydrationPromise }) => {
          return () => {
            hydrationPromise.resolve(true);
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
    editorRef.current = store;

    return () => {
      if (store === editorRef.current) {
        editorRef.current = undefined;
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

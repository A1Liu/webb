"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import md5 from "md5";
import { ZustandIdbStorage } from "../util";
import { InitGroup } from "../constants";
import { useShallow } from "zustand/react/shallow";
import { bytesToBase64 } from "../crypto";
import { useUserProfile } from "./userProfile";

const NoteDataSchemaInternal = z.object({
  id: z.string(),
  preview: z.string(),
  hash: z.string(),
  base64EncryptionIvParam: z
    .discriminatedUnion("__typename", [
      z.object({ __typename: z.literal("NoLock") }),

      // Both of these mean it's locked
      z.object({ __typename: z.literal("Lock"), key: z.string().nullish() }),
    ])
    .nullish(),
  isTombstone: z.boolean().optional(),
  lastUpdateDate: z.coerce.date(),
  lastSyncDate: z.coerce.date(),
  lastSyncHash: z.string(),
});

export type NoteData = z.infer<typeof NoteDataSchema>;
export const NoteDataSchema = NoteDataSchemaInternal.extend({
  merges: NoteDataSchemaInternal.array().nullish(),
});

export interface NoteGlobalState {
  activeNote: string;
  notes: Map<string, NoteData>;

  cb: {
    updateNote: (id: string, updater: (prev: NoteData) => NoteData) => void;
    updateNotesFromSync: (notes: NoteData[]) => { contentsChanged: NoteData[] };
    setActiveNote: (id: string) => void;
    lockAll: () => void;
  };
}

const ZERO_TIME = new Date(0);

function createEmptyNote(id: string): NoteData {
  const hasAuth = !!useUserProfile.getState().userProfile?.secret;
  return {
    id,
    hash: md5(""),
    preview: "",
    lastUpdateDate: ZERO_TIME,
    lastSyncDate: ZERO_TIME,
    lastSyncHash: md5(""),
    base64EncryptionIvParam: hasAuth
      ? {
          __typename: "Lock",
          key: bytesToBase64(window.crypto.getRandomValues(new Uint8Array(12))),
        }
      : undefined,
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
              const prevNote: NoteData =
                notes.get(noteId) ?? createEmptyNote(noteId);

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
          lockAll: () => {
            if (!useUserProfile.getState().userProfile?.secret) return;

            set((prev) => {
              const notes = new Map<string, NoteData>();
              for (const note of prev.notes.values()) {
                notes.set(note.id, {
                  ...note,
                  base64EncryptionIvParam: {
                    __typename: "Lock",
                    key: bytesToBase64(
                      window.crypto.getRandomValues(new Uint8Array(12)),
                    ),
                  },
                });
              }

              return { notes };
            });
          },
          setActiveNote: (id) =>
            set((prev) => {
              if (prev.activeNote === id) {
                return prev;
              }
              const prevActive = prev.notes.get(prev.activeNote ?? "");
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

export function useActiveNote(): NoteData {
  return useNotesState(
    useShallow(
      (state) =>
        state.notes.get(state.activeNote) ?? createEmptyNote(state.activeNote),
    ),
  );
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

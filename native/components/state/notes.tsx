"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import md5 from "md5";
import isEqual from "lodash/isEqual";
import { InitGroup } from "../constants";
import { useLocks } from "./locks";
import { ZustandIdbStorage } from "../util";

const NoteDataSchemaInternal = z.object({
  id: z.string(),
  preview: z.string(),
  lockId: z.string().nullish(),
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
    updateNote: (
      id: string,
      updater: (prev: NoteData) => NoteData,
      reoder?: boolean,
    ) => void;
    updateNotesFromSync: (notes: NoteData[]) => { contentsChanged: NoteData[] };
    setActiveNote: (id: string) => void;
    lockAll: () => void;
  };
}

const ZERO_TIME = new Date(0);

function createEmptyNote(id: string): NoteData {
  const lock = useLocks.getState().cb.getLock();
  return {
    id,
    lockId: lock?.id,
    preview: "",
    lastUpdateDate: ZERO_TIME,
    lastSyncDate: ZERO_TIME,
    lastSyncHash: md5(""),
  };
}

export const useNotesState = create<NoteGlobalState>()(
  persist(
    (set, get) => {
      return {
        activeNote: uuid(),
        notes: new Map(),
        cb: {
          updateNote: (noteId, updater, reorder = false) => {
            set((prev) => {
              const notes = new Map(prev.notes);
              const prevNote: NoteData =
                notes.get(noteId) ?? createEmptyNote(noteId);

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

                // We don't want merges because that's just noise.
                // We ALSO don't want lastSyncDate, because that updates
                // on every sync. Last sync hash is pretty likely to not have
                // changed since last time though. Unless there's new content
                // which is a true positive anyways.
                const {
                  merges: _a,
                  lastSyncDate: _b,
                  ...prevNoteData
                } = prevNote;
                const { merges: _w, lastSyncDate: _x, ...newNoteData } = note;

                // NOTE: Technically, we might be able to get away with
                // only updating when the `hash` field changes. However,
                // we'd need to fix any inconsistencies caused by mismatches
                // between the content store and the metadata store.
                if (!isEqual(prevNoteData, newNoteData)) return true;

                return false;
              }),
            };
          },
          lockAll: () => {
            const lock = useLocks.getState().cb.getLock();
            if (!lock) return;

            set((prev) => {
              const notes = new Map<string, NoteData>();
              for (const note of prev.notes.values()) {
                notes.set(note.id, { ...note, lockId: lock.id });
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
              if (prevActive && prevActive.preview === "") {
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

export function useNoteMetadata(noteId: string): NoteData {
  return useNotesState(
    useShallow((state) => state.notes.get(noteId) ?? createEmptyNote(noteId)),
  );
}

const selector = (state: NoteGlobalState) =>
  state.notes.get(state.activeNote) ?? createEmptyNote(state.activeNote);
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

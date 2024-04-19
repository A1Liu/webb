"use client";

import React from "react";
import { buttonClass } from "@/components/TopbarLayout";
import { useRequest } from "ahooks";
import { usePlatform } from "@/components/hooks/usePlatform";
import { z } from "zod";
import toast from "react-hot-toast";
import { getOrCompute } from "@a1liu/webb-ui-shared/util";
import {
  NoteData,
  NoteDataSchema,
  NotesSyncInitGroup,
  useNotesState,
} from "@/components/state/notes";
import { usePeers } from "@/components/state/peers";
import { registerRpc, registerListener } from "@/components/network";
import {
  readNoteContents,
  writeNoteContents,
} from "@/components/state/noteContents";
import { PermissionKeySchema } from "@/components/crypto";
import { useLocks } from "@/components/state/locks";

const SYNC_STATUS_TOAST_ID = "sync-status-toast-id";
const ACTIVE_SYNC_STATUS_TOAST_ID = "active-sync-status-toast-id";

const NoteDataFetch = registerRpc({
  name: "NoteDataFetch",
  group: NotesSyncInitGroup,
  input: z.object({
    noteId: z.string(),
    permissionKey: PermissionKeySchema.nullish(),
  }),
  output: z.object({ noteId: z.string(), text: z.string() }),
  rpc: async function* (peerId, { noteId, permissionKey }) {
    console.debug(`received NoteDataFetch req`, peerId);

    const noteMetadata = useNotesState.getState().notes.get(noteId);
    if (!noteMetadata) return;

    if (noteMetadata.lockId) {
      if (permissionKey?.lockId !== noteMetadata.lockId) {
        return; // missing cert, or wrong key
      }
      if (peerId !== permissionKey.deviceId) {
        return; // Using a key not given to them
      }

      const verified = await useLocks.getState().cb.verifyKey(permissionKey);
      if (!verified) return;

      // OK we're verififed
    }

    const text = await readNoteContents(noteId);
    if (!text) return;

    yield { noteId, text };
  },
});

const NotePushListener = registerListener({
  channel: "NotePushListener",
  group: NotesSyncInitGroup,
  schema: z.object({
    notes: NoteDataSchema.extend({
      key: PermissionKeySchema.nullish(),
    }).array(),
  }),
  listener: async (peerId, { notes }) => {
    const { cb } = useNotesState.getState();

    console.debug(`received NotePush req`);
    toast.loading(`Syncing ... writing notes`, {
      id: SYNC_STATUS_TOAST_ID,
    });

    let written = 0;

    const { contentsChanged } = cb.updateNotesFromSync(notes);
    for (const note of contentsChanged) {
      toast.loading(
        `Syncing - updating notes (${++written}/${contentsChanged.length})`,
        {
          id: SYNC_STATUS_TOAST_ID,
        },
      );

      const dataFetchResult = NoteDataFetch.call(peerId, {
        noteId: note.id,
        permissionKey: note.lockId
          ? await useLocks.getState().cb.createKey(note.lockId)
          : undefined,
      });

      for await (const item of dataFetchResult) {
        const { noteId, text } = item;
        await writeNoteContents(noteId, text);
      }
    }

    console.debug(`executed NotePush`);
    toast.success(`Sync complete!`, {
      id: SYNC_STATUS_TOAST_ID,
    });
  },
});

const NoteListMetadata = registerRpc({
  name: "NoteListMetadata",
  group: NotesSyncInitGroup,
  input: z.object({}),
  output: z.object({
    note: NoteDataSchema,
    permissionKey: PermissionKeySchema.nullish(),
  }),
  rpc: async function* (peerId, _input) {
    console.debug(`received NoteListMetadata req`, peerId);

    const { notes } = useNotesState.getState();
    for (const [_noteId, note] of notes.entries()) {
      yield {
        note: { ...note },
        permissionKey: note.lockId
          ? await useLocks.getState().cb.createKey(note.lockId)
          : undefined,
      };
    }
  },
});

export function SyncNotesButton() {
  const { peers } = usePeers();
  const { notes, cb } = useNotesState();
  const { isMobile } = usePlatform();
  const { runAsync, loading } = useRequest(
    async () => {
      if (!peers) return;

      console.debug("Sync starting...");
      toast.loading(`Syncing ... fetching notes`, {
        id: ACTIVE_SYNC_STATUS_TOAST_ID,
      });

      const noteVersions = new Map<
        string,
        (NoteData & { peerId?: string })[]
      >();
      for (const note of notes.values()) {
        noteVersions.set(note.id, [
          { ...note, merges: undefined, peerId: undefined },
        ]);
      }

      let totalCount = 0;
      for (const peer of peers.values()) {
        const stream = NoteListMetadata.call(peer.id, {});
        for await (const { note } of stream) {
          const versions = getOrCompute(noteVersions, note.id, () => []);
          versions.push({ ...note, merges: undefined, peerId: peer.id });

          toast.loading(`Syncing ... fetching notes (${++totalCount})`, {
            id: ACTIVE_SYNC_STATUS_TOAST_ID,
          });
        }
      }

      const notesToUpdate = [];
      for (const [_noteId, versions] of noteVersions.entries()) {
        const { ...maxSyncNote } = versions.reduce((maxNote, note) => {
          if (maxNote.hash === note.hash) {
            if (!note.peerId) return note;
            return maxNote;
          }

          if (note.hash === maxNote.lastSyncHash) return maxNote;
          if (maxNote.hash === note.lastSyncHash) return note;

          if (note.lastSyncDate > maxNote.lastSyncDate) return note;
          if (note.lastSyncDate < maxNote.lastSyncDate) return maxNote;

          // TODO: figure out why the timestamps are getting... rounded?
          // truncated? something is up with the timestamp math.
          if (note.lastUpdateDate > maxNote.lastUpdateDate) return note;
          if (note.lastUpdateDate < maxNote.lastUpdateDate) return maxNote;

          return maxNote;
        });

        const relevantVersions = versions.filter((version) => {
          if (version.hash === maxSyncNote.hash) return false;
          if (version.hash === maxSyncNote.lastSyncHash) return false;

          return true;
        });

        let merges: NoteData["merges"] = undefined;
        if (relevantVersions.length > 0) {
          merges = relevantVersions;
        }

        if (!merges) {
          maxSyncNote.lastSyncHash = maxSyncNote.hash;
          maxSyncNote.lastSyncDate = new Date();
        }

        notesToUpdate.push({
          ...maxSyncNote,
          merges,
        });
      }
      cb.updateNotesFromSync(
        notesToUpdate.map(({ peerId, ...noteData }) => noteData),
      );

      for (const note of notesToUpdate) {
        if (!note.peerId) {
          // it's our own note version
          continue;
        }

        const result = NoteDataFetch.call(note.peerId, {
          noteId: note.id,
          permissionKey: note.lockId
            ? await useLocks.getState().cb.createKey(note.lockId)
            : undefined,
        });

        for await (const item of result) {
          const { noteId, text } = item;
          await writeNoteContents(noteId, text);
        }
      }

      console.debug(`Finalized ${notesToUpdate.length} notes`);
      toast.loading(`Syncing ... resolved ${notesToUpdate.length} notes`, {
        id: ACTIVE_SYNC_STATUS_TOAST_ID,
      });

      const notesToSend = await Promise.all(
        notesToUpdate.map(async ({ peerId, ...noteData }) => ({
          ...noteData,
          permissionKey: noteData.lockId
            ? await useLocks.getState().cb.createKey(noteData.lockId)
            : undefined,
        })),
      );

      for (const [peerId, _peer] of peers.entries()) {
        await NotePushListener.send(peerId, { notes: notesToSend });
      }

      toast.success(`Sync complete!`, {
        id: ACTIVE_SYNC_STATUS_TOAST_ID,
      });
    },
    { manual: true },
  );

  if (isMobile) return null;

  return (
    <button
      className={buttonClass}
      disabled={!peers.size || loading}
      onClick={() => {
        runAsync();
      }}
    >
      Sync
    </button>
  );
}

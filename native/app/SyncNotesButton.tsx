"use client";

import React from "react";
import { buttonClass } from "@/components/TopbarLayout";
import md5 from "md5";
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
import { getNetworkLayerGlobal, usePeers } from "@/components/state/peers";

export const dynamic = "force-static";

const SYNC_STATUS_TOAST_ID = "sync-status-toast-id";
const ACTIVE_SYNC_STATUS_TOAST_ID = "active-sync-status-toast-id";

NotesSyncInitGroup.registerInit("InitSyncFetchResponder", async () => {
  const network = getNetworkLayerGlobal();
  while (true) {
    await network.rpcSingleExec("notes-fetch", async function* (chunk) {
      console.debug(`received notes-fetch req`, chunk.peerId);

      const { notes } = useNotesState.getState();
      for (const [_noteId, note] of notes.entries()) {
        yield { note };
      }
    });
  }
});

NotesSyncInitGroup.registerInit("InitSyncWriter", async () => {
  const network = getNetworkLayerGlobal();
  const { cb } = useNotesState.getState();
  while (true) {
    const countChunk = await network.recv({
      channel: "notes-write",
    });

    console.debug(`received notes-write req`);
    toast.loading(`Syncing ... writing notes`, {
      id: SYNC_STATUS_TOAST_ID,
    });

    const stream = network.rpcCall({
      peerId: countChunk.peerId,
      channel: "notes-fetch",
      data: "",
    });

    const notesToUpdate = [];
    for await (const chunk of stream) {
      const result = z.object({ note: NoteDataSchema }).safeParse(chunk.data);
      if (!result.success) {
        toast.error(`parse error ${String(result.error)}`);
        continue;
      }

      toast.loading(
        `Syncing ... fetching notes (${notesToUpdate.length + 1})`,
        { id: SYNC_STATUS_TOAST_ID },
      );
      notesToUpdate.push(result.data.note);
    }

    toast.loading(`Syncing ... writing notes (${notesToUpdate.length})`, {
      id: SYNC_STATUS_TOAST_ID,
    });

    cb.updateNotesFromSync(notesToUpdate);

    console.debug(`executed notes-write`);
    toast.success(`Sync complete!`, {
      id: SYNC_STATUS_TOAST_ID,
    });
  }
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

      const network = getNetworkLayerGlobal();
      const noteVersions = new Map<string, NoteData[]>();
      for (const [key, note] of (notes ?? new Map()).entries()) {
        noteVersions.set(key, [
          { ...note, merges: undefined },
          ...(note.merges ?? []),
        ]);
      }

      const rpcStreams = [];

      for (const [peerId, _peer] of peers.entries()) {
        rpcStreams.push(
          network.rpcCall({
            peerId,
            channel: "notes-fetch",
            data: "",
          }),
        );
      }

      let totalCount = 0;
      for (const stream of rpcStreams) {
        for await (const chunk of stream) {
          const result = z
            .object({ note: NoteDataSchema })
            .safeParse(chunk.data);
          if (!result.success) {
            toast.error(`parse error ${String(result.error)}`);
            continue;
          }

          const note = result.data.note;
          const versions = getOrCompute(noteVersions, note.id, () => []);
          versions.push(note);

          toast.loading(`Syncing ... fetching notes (${++totalCount})`, {
            id: ACTIVE_SYNC_STATUS_TOAST_ID,
          });
        }
      }

      console.debug(`fetch handling done`);

      const outboundNotes = new Map<string, NoteData>();
      const notesToUpdate = [];
      for (const [noteId, versions] of noteVersions.entries()) {
        const { ...maxSyncNote } = versions.reduce((maxNote, note) => {
          // TODO: figure out why the timestamps are getting... rounded?
          // truncated? something is up with the timestamp math.
          if (md5(maxNote.text) === note.lastSyncHash) return note;
          if (md5(note.text) === maxNote.lastSyncHash) return maxNote;

          if (note.lastSyncDate > maxNote.lastSyncDate) return note;
          if (note.lastSyncDate < maxNote.lastSyncDate) return maxNote;

          return maxNote;
        });

        const relevantVersions = versions.filter((version) => {
          if (version.text === maxSyncNote.text) return false;
          if (md5(version.text) === maxSyncNote.lastSyncHash) return false;

          return true;
        });

        let merges: NoteData["merges"] = undefined;
        if (relevantVersions.length > 0) {
          merges = relevantVersions;
        }

        if (!merges) {
          maxSyncNote.lastSyncHash = md5(maxSyncNote.text);
          maxSyncNote.lastSyncDate = new Date();
          outboundNotes.set(noteId, maxSyncNote);
        }

        notesToUpdate.push({
          ...maxSyncNote,
          merges,
        });
      }
      cb.updateNotesFromSync(notesToUpdate);

      console.debug(`Finalized ${outboundNotes.size} notes`);
      toast.loading(`Syncing ... resolved ${outboundNotes.size} notes`, {
        id: ACTIVE_SYNC_STATUS_TOAST_ID,
      });

      for (const [peerId, _peer] of peers.entries()) {
        await network.sendData({
          peerId,
          channel: "notes-write",
          ignorePeerIdForChannel: true,
          data: {},
        });
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

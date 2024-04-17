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
  useNotesState,
} from "@/components/state/notes";
import { getNetworkLayerGlobal, usePeers } from "@/components/state/peers";
import { InitGroup } from "@/components/constants";

export const dynamic = "force-static";

const SYNC_STATUS_TOAST_ID = "sync-status-toast-id";
const ACTIVE_SYNC_STATUS_TOAST_ID = "active-sync-status-toast-id";

export const NotesSyncInitGroup = new InitGroup("notesSync");

NotesSyncInitGroup.registerInit("InitSyncFetchResponder", async () => {
  const network = getNetworkLayerGlobal();
  while (true) {
    const chunk = await network.recv({
      channel: "notes-fetch",
    });

    console.debug(`received notes-fetch req`, chunk.peerId);
    toast.loading(`Syncing ... sending notes`, {
      id: SYNC_STATUS_TOAST_ID,
    });

    const { notes } = useNotesState.getState();
    await network.sendData({
      peerId: chunk.peerId,
      channel: "notes-fetch-count",
      data: { count: notes.size },
    });

    for (const [_noteId, note] of notes.entries()) {
      await network.sendData({
        peerId: chunk.peerId,
        channel: "notes-fetch-data",
        data: { note },
      });
    }
  }
});

NotesSyncInitGroup.registerInit("InitSyncWriter", async () => {
  const network = getNetworkLayerGlobal();
  const { cb } = useNotesState.getState();
  while (true) {
    const countChunk = await network.recv({
      channel: "notes-write-count",
    });

    console.debug(`received notes-write req`);
    toast.loading(`Syncing ... writing notes`, {
      id: SYNC_STATUS_TOAST_ID,
    });

    const countResult = z
      .object({ count: z.number() })
      .safeParse(countChunk.data);
    if (!countResult.success) {
      toast.error(`parse error ${String(countResult.error)}`);
      continue;
    }

    console.debug(`reading notes-write-data`);

    const count = countResult.data.count;

    const notesToUpdate = [];
    for (let i = 0; i < count; i++) {
      toast.loading(`Syncing ... fetching notes (${i + 1})`, {
        id: SYNC_STATUS_TOAST_ID,
      });

      const chunk = await network.recv({
        peerId: countChunk.peerId,
        channel: "notes-write-data",
      });
      const result = z.object({ note: NoteDataSchema }).safeParse(chunk.data);
      if (!result.success) {
        toast.error(`parse error ${String(result.error)}`);
        continue;
      }

      notesToUpdate.push(result.data.note);
    }

    toast.loading(`Syncing ... writing notes (${count})`, {
      id: SYNC_STATUS_TOAST_ID,
    });
    cb.updateNotesFromSync(notesToUpdate);

    console.debug(`executed notes-write-data`);
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

      for (const [peerId, _peer] of peers.entries()) {
        await network.sendData({
          peerId,
          channel: "notes-fetch",
          ignorePeerIdForChannel: true,
          data: "",
        });
      }

      let totalCount = 0;
      for (const [peerId, _peer] of peers.entries()) {
        const countChunk = await network.recv({
          peerId,
          channel: "notes-fetch-count",
        });

        const countResult = z
          .object({ count: z.number() })
          .safeParse(countChunk.data);
        if (!countResult.success) {
          toast.error(`parse error ${String(countResult.error)}`);
          continue;
        }

        const count = countResult.data.count;

        for (let i = 0; i < count; i++) {
          const chunk = await network.recv({
            peerId,
            channel: "notes-fetch-data",
          });
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
          channel: "notes-write-count",
          ignorePeerIdForChannel: true,
          data: { count: outboundNotes.size },
        });

        for (const [_noteId, note] of outboundNotes.entries()) {
          await network.sendData({
            peerId,
            channel: "notes-write-data",
            data: { note },
          });
        }
      }

      toast.success(`Sync complete!`, {
        id: ACTIVE_SYNC_STATUS_TOAST_ID,
      });
    },
    {
      manual: true,
    },
  );

  if (isMobile) return null;

  return (
    <button
      className={buttonClass}
      disabled={!peers?.size || loading}
      onClick={() => {
        runAsync();
      }}
    >
      Sync
    </button>
  );
}

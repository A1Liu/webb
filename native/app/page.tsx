"use client";

import React, { useEffect } from "react";
import { buttonClass, TopbarLayout } from "@/components/TopbarLayout";
import {
  getNetworkLayerGlobal,
  NoteData,
  NoteDataSchema,
  NO_HYDRATE,
  useGlobals,
  useModifyGlobals,
  usePersistedState,
} from "@/components/globals";
import { v4 as uuid } from "uuid";
import md5 from "md5";
import { useDebounceFn, useRequest } from "ahooks";
import { usePlatform } from "@/components/hooks/usePlatform";
import { z } from "zod";
import toast from "react-hot-toast";
import { getOrCompute, memoize } from "@a1liu/webb-ui-shared/util";

export const dynamic = "force-static";

const initSyncListener = memoize(async () => {
  const network = getNetworkLayerGlobal();
  while (true) {
    const chunk = await network.recv({
      peerId: "",
      channel: "notes-fetch",
      ignorePeerIdForChannel: true,
    });
    console.log(`received notes-fetch req`, JSON.stringify(chunk));

    const { persistedState } = useGlobals.getState();
    if (persistedState === NO_HYDRATE || !persistedState.notes) {
      await network.sendData({
        peerId: chunk.peerId,
        channel: "notes-fetch-count",
        data: { count: 0 },
      });
      continue;
    }

    await network.sendData({
      peerId: chunk.peerId,
      channel: "notes-fetch-count",
      data: { count: persistedState.notes.size },
    });

    for (const [_noteId, note] of persistedState.notes.entries()) {
      await network.sendData({
        peerId: chunk.peerId,
        channel: "notes-fetch-data",
        data: { note },
      });
    }
  }
});

const initSyncWriteListener = memoize(async () => {
  const network = getNetworkLayerGlobal();
  const { cb } = useGlobals.getState();
  while (true) {
    const countChunk = await network.recv({
      peerId: "",
      channel: "notes-write-count",
      ignorePeerIdForChannel: true,
    });
    console.log(`received notes-write req`);

    const countResult = z
      .object({ count: z.number() })
      .safeParse(countChunk.data);
    if (!countResult.success) {
      toast.error(`parse error ${String(countResult.error)}`);
      continue;
    }

    console.log(`reading notes-write-data`);

    const count = countResult.data.count;

    for (let i = 0; i < count; i++) {
      const chunk = await network.recv({
        peerId: countChunk.peerId,
        channel: "notes-write-data",
      });
      const result = z.object({ note: NoteDataSchema }).safeParse(chunk.data);
      if (!result.success) {
        toast.error(`parse error ${String(result.error)}`);
        continue;
      }

      const note = result.data.note;
      cb.updateNote(note);
    }

    console.log(`executed notes-write-data`);
  }
});

function SyncNotesButton() {
  const { peers, notes } = usePersistedState();
  const cb = useModifyGlobals();
  const { isMobile } = usePlatform();
  const { runAsync, loading } = useRequest(
    async () => {
      console.log("sync clicked...");
      if (!peers) return;

      console.log("sync starting...");

      const network = getNetworkLayerGlobal();
      const noteVersions = new Map<string, NoteData[]>();
      for (const [key, note] of (notes ?? new Map()).entries()) {
        noteVersions.set(key, [
          { ...note, merges: undefined },
          ...(note.merges ?? []),
        ]);
      }

      console.log("sync setup done");
      for (const [peerId, _peer] of peers.entries()) {
        await network.sendData({
          peerId,
          channel: "notes-fetch",
          ignorePeerIdForChannel: true,
          data: "",
        });
      }

      console.log("sync requests sent");

      for (const [peerId, _peer] of peers.entries()) {
        const countChunk = await network.recv({
          peerId,
          channel: "notes-fetch-count",
        });

        console.log(`fetch-count gotten`);

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
        }

        console.log(`fetch handling done`);
      }

      const outboundNotes = new Map<string, NoteData>();
      for (const [noteId, versions] of noteVersions.entries()) {
        const { ...maxSyncNote } = versions.reduce((maxNote, note) => {
          if (note.lastSyncDate > maxNote.lastSyncDate) return note;
          if (note.lastSyncDate < maxNote.lastSyncDate) return maxNote;

          if (note.lastUpdateDate > maxNote.lastUpdateDate) return note;

          return maxNote;
        });

        const relevantVersions = versions.filter((version) => {
          if (version.text === maxSyncNote.text) return false;
          if (version.lastUpdateDate > maxSyncNote.lastSyncDate) return true;

          return true;
        });

        let merges: NoteData["merges"] = undefined;
        if (relevantVersions.length > 0) {
          merges = relevantVersions;
        }

        if (!merges) {
          maxSyncNote.lastSyncDate = new Date();
          maxSyncNote.lastUpdateDate = maxSyncNote.lastSyncDate;
          outboundNotes.set(noteId, maxSyncNote);
        }

        cb.updateNote({
          ...maxSyncNote,
          merges,
        });
      }

      console.log(`Finalized ${outboundNotes.size} notes`);

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
    },
    {
      manual: true,
    }
  );

  useEffect(() => {
    initSyncListener();
    initSyncWriteListener();
  }, []);

  if (isMobile) return null;

  return (
    <button
      className={buttonClass}
      disabled={!peers?.size || loading}
      onClick={() => {
        console.log("ehllo");
        runAsync();
      }}
    >
      Sync
    </button>
  );
}

function SelectActiveNote() {
  const cb = useModifyGlobals();
  const notes = usePersistedState((state) => state.notes);
  const activeNote = usePersistedState((state) => state.activeNote);

  return (
    <select
      className="bg-slate-800"
      value={activeNote}
      onChange={(evt) => {
        cb.setActiveNote(evt.target.value);
      }}
    >
      <option key={"dummy"} value={undefined}>
        -- New note --
      </option>

      {[...(notes ? notes?.values() : [])].map((note) => {
        return (
          <option key={note.id} value={note.id}>
            {note.merges ? "*" : ""}
            {note.text.split("\n", 1)[0]}
          </option>
        );
      })}
    </select>
  );
}

export default function Home() {
  const cb = useModifyGlobals();
  const note = usePersistedState(
    (state) =>
      state.notes?.get(state.activeNote ?? "") ?? {
        id: uuid(),
        hash: md5(""),
        text: "",
        lastSyncDate: new Date(),
        lastUpdateDate: new Date(),
      }
  );

  const { run: updateHash } = useDebounceFn(
    (id: string, text: string) => {
      cb.updateNote({
        id,
        lastUpdateDate: new Date(),
        lastSyncDate: note.lastSyncDate,
        text,
        hash: md5(text),
      });
    },
    {
      trailing: true,
      wait: 500,
    }
  );

  return (
    <TopbarLayout
      title={"Home"}
      buttons={[
        {
          type: "link",
          text: "Settings",
          href: "/settings",
        },
        {
          type: "button",
          text: "Refresh",
          onClick: () => window.location.reload(),
        },
      ]}
    >
      <div className="absolute top-12 right-4 flex gap-2">
        <SelectActiveNote />
        <SyncNotesButton />
      </div>

      <textarea
        className="bg-black outline-none flex-grow resize-none"
        value={note.text}
        onChange={(evt) => {
          cb.updateNote({
            ...note,
            text: evt.target.value,
            lastUpdateDate: new Date(),
            lastSyncDate: note.lastSyncDate,
          });
          cb.setActiveNote(note.id);
          updateHash(note.id, evt.target.value);
        }}
      />
    </TopbarLayout>
  );
}

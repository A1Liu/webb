"use client";

import React from "react";
import { buttonClass } from "@/components/TopbarLayout";
import { useLockFn, useRequest } from "ahooks";
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
  EMPTY_HASH,
  readNoteContents,
  useNoteHashStore,
  writeNoteContents,
} from "@/components/state/noteContents";
import {
  AdminKeySchema,
  PermissionKeySchema,
  signValue,
  verifyValue,
} from "@/components/crypto";
import { useLocks } from "@/components/state/locks";
import { useUserProfile } from "@/components/state/userProfile";
import { useDeviceProfile } from "@/components/state/deviceProfile";

const NoteMetadataWithHashSchema = z.object({
  note: NoteDataSchema,
  hash: z.string(),
});

const SYNC_STATUS_TOAST_ID = "sync-status-toast-id";
const ACTIVE_SYNC_STATUS_TOAST_ID = "active-sync-status-toast-id";

export const NoteDataFetch = registerRpc({
  name: "NoteDataFetch",
  group: NotesSyncInitGroup,
  input: z.object({
    noteId: z.string(),
    permissionKey: PermissionKeySchema.nullish(),
  }),
  output: z.object({ noteId: z.string(), text: z.string() }),
  rpc: async function* (peerId, { noteId, permissionKey }) {
    console.debug(`received NoteDataFetch req`, peerId);

    const { cb: locksCb } = useLocks.getState();
    const { notes } = useNotesState.getState();
    const noteMetadata = notes.get(noteId);
    if (!noteMetadata) return;

    if (noteMetadata.lockId) {
      if (permissionKey?.lockId !== noteMetadata.lockId) {
        return; // missing cert, or wrong key
      }
      if (peerId !== permissionKey.deviceId) {
        return; // Using a key not given to them
      }

      const verified = await locksCb.verifyKey(permissionKey);
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
    notes: NoteMetadataWithHashSchema.array(),
    adminAuth: AdminKeySchema,
  }),
  listener: async (
    peerId,
    { notes, adminAuth: { base64Signature: adminSignature, ...adminAuth } },
  ) => {
    if (adminAuth.deviceId !== peerId) {
      toast.error(`Received synchronization request with mismatched deviceId`);
      return;
    }

    const now = new Date().getTime();
    if (adminAuth.timestamp.getTime() > now) {
      toast.error(`Received synchronization request with future auth`);
      return;
    }

    const fifteenMinutes = 1000 * 60 * 15;
    const stalenessThreshold = now - fifteenMinutes;
    if (stalenessThreshold > adminAuth.timestamp.getTime()) {
      toast.error(`Received synchronization request with outdated auth`);
      return;
    }

    const userProfile = useUserProfile.getState().userProfile;
    if (!userProfile) {
      console.debug(`Device has no user, refusing to sync`);
      return;
    }

    const adminAuthValid = await verifyValue({
      publicKey: userProfile.publicAuthKey,
      signature: adminSignature,
      value: adminAuth,
    });
    if (!adminAuthValid) {
      toast.error(
        `Received synchronization request from unauthorized requester`,
      );
      return;
    }

    console.debug(`received NotePush req`);
    toast.loading(`Syncing ... writing notes`, {
      id: SYNC_STATUS_TOAST_ID,
    });

    const { cb } = useNotesState.getState();
    const { cb: locksCb } = useLocks.getState();

    let written = 0;

    const { hashes } = useNoteHashStore.getState();
    cb.updateNotesFromSync(notes.map(({ note }) => note));
    for (const { hash, note } of notes) {
      toast.loading(`Syncing - updating notes (${++written})`, {
        id: SYNC_STATUS_TOAST_ID,
      });

      const prevHash = hashes.get(note.id);
      if (prevHash === hash) {
        continue;
      }

      const dataFetchResult = NoteDataFetch.call(peerId, {
        noteId: note.id,
        permissionKey: note.lockId
          ? await locksCb.createKey(note.lockId)
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
  output: NoteMetadataWithHashSchema.extend({
    permissionKey: PermissionKeySchema.nullish(),
  }),
  rpc: async function* (peerId, {}) {
    console.debug(`received NoteListMetadata req`, peerId);

    const { notes } = useNotesState.getState();
    const { cb: locksCb } = useLocks.getState();
    const { hashes } = useNoteHashStore.getState();

    for (const note of notes.values()) {
      yield {
        note: { ...note },
        hash: hashes.get(note.id) ?? EMPTY_HASH,
        permissionKey: note.lockId
          ? await locksCb.createKey(note.lockId)
          : undefined,
      };
    }
  },
});

async function syncNotes() {
  const { peers } = usePeers.getState();
  if (!peers) {
    toast.error(`No peers to synchronize with!`);
    return;
  }

  const { userProfile } = useUserProfile.getState();
  const userSecret = userProfile?.secret;
  if (!userSecret) {
    toast.error(`No UserProfile to synchronize with!`);
    return;
  }

  const { deviceProfile } = useDeviceProfile.getState();
  if (!deviceProfile) {
    toast.error(`No Device ID to synchronize with!`);
    return;
  }

  const timestamp = new Date();
  timestamp.setMilliseconds(0);
  const adminAuth = await signValue({
    privateKey: userSecret.privateAuthKey,
    value: {
      deviceId: deviceProfile.id,
      timestamp,
    },
  });

  console.debug("Sync starting...");
  toast.loading(`Syncing ... fetching notes`, {
    id: ACTIVE_SYNC_STATUS_TOAST_ID,
  });

  const { hashes } = useNoteHashStore.getState();
  const { notes, cb } = useNotesState.getState();

  const noteVersions = new Map<
    string,
    {
      localVersion?: NoteData;
      versions: { peerId?: string; note: NoteData; hash: string }[];
    }
  >();
  for (const { merges, ...note } of notes.values()) {
    noteVersions.set(note.id, {
      localVersion: note,
      versions: [{ note, hash: hashes.get(note.id) ?? EMPTY_HASH }],
    });
  }

  const { cb: locksCb } = useLocks.getState();

  let totalCount = 0;
  for (const peer of peers.values()) {
    console.log("asdf asdf");
    const stream = NoteListMetadata.call(peer.id, {});
    console.log("wassa wassa");
    for await (const { hash, note, permissionKey } of stream) {
      console.log("wassa wassa 2");

      const { localVersion, versions } = getOrCompute(
        noteVersions,
        note.id,
        () => ({ versions: [] }),
      );
      if (localVersion?.lockId) {
        if (permissionKey?.lockId !== localVersion.lockId) {
          continue; // missing cert, or wrong key
        }
        if (peer.id !== permissionKey.deviceId) {
          continue; // Using a key not given to them
        }

        const verified = await locksCb.verifyKey(permissionKey);
        if (!verified) continue;
      }

      versions.push({
        peerId: peer.id,
        hash,
        note: { ...note, merges: undefined },
      });

      toast.loading(`Syncing ... fetching notes (${++totalCount})`, {
        id: ACTIVE_SYNC_STATUS_TOAST_ID,
      });
    }
  }

  const notesToUpdate = [];
  for (const [_noteId, { versions }] of noteVersions.entries()) {
    const {
      note: maxSyncNote,
      hash: maxHash,
      peerId,
    } = versions.reduce((maxNoteInfo, noteInfo) => {
      // TODO: Figure out what to do with locks here
      if (maxNoteInfo.hash === noteInfo.hash) {
        if (!noteInfo.peerId) return noteInfo;
        return maxNoteInfo;
      }

      const { note: maxNote } = maxNoteInfo;
      const { note: note } = noteInfo;

      if (noteInfo.hash === maxNote.lastSyncHash) return maxNoteInfo;
      if (maxNoteInfo.hash === note.lastSyncHash) return noteInfo;

      if (note.lastSyncDate > maxNote.lastSyncDate) return noteInfo;
      if (note.lastSyncDate < maxNote.lastSyncDate) return maxNoteInfo;

      // TODO: figure out why the timestamps are getting... rounded?
      // truncated? something is up with the timestamp math.
      if (note.lastUpdateDate > maxNote.lastUpdateDate) return noteInfo;
      if (note.lastUpdateDate < maxNote.lastUpdateDate) return maxNoteInfo;

      return maxNoteInfo;
    });

    const relevantVersions = versions.filter((version) => {
      if (version.hash === maxHash) return false;
      if (version.hash === maxSyncNote.lastSyncHash) return false;

      return true;
    });

    let merges: NoteData["merges"] = undefined;
    if (relevantVersions.length > 0) {
      merges = relevantVersions.map(({ note }) => note);
    }

    if (!merges) {
      maxSyncNote.lastSyncHash = maxHash;
      maxSyncNote.lastSyncDate = new Date();
    }

    notesToUpdate.push({
      peerId,
      hash: maxHash,
      note: { ...maxSyncNote },
      merges,
    });
  }
  cb.updateNotesFromSync(notesToUpdate.map(({ note }) => note));

  for (const { peerId, note } of notesToUpdate) {
    if (!peerId) {
      // it's our own note version
      continue;
    }

    const result = NoteDataFetch.call(peerId, {
      noteId: note.id,
      permissionKey: note.lockId
        ? await locksCb.createKey(note.lockId)
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

  for (const [peerId, _peer] of peers.entries()) {
    await NotePushListener.send(peerId, {
      adminAuth,
      notes: notesToUpdate.map(({ hash, note }) => ({
        note,
        hash,
      })),
    });
  }

  toast.success(`Sync complete!`, {
    id: ACTIVE_SYNC_STATUS_TOAST_ID,
  });
}

export function SyncNotesButton() {
  const { peers } = usePeers();
  const { isMobile } = usePlatform();
  const { userProfile } = useUserProfile();
  const { runAsync, loading } = useRequest(syncNotes, { manual: true });

  const runSynchronization = useLockFn(runAsync);

  if (isMobile) return null;

  return (
    <button
      className={buttonClass}
      disabled={!peers.size || !userProfile || loading}
      onClick={() => {
        runSynchronization();
      }}
    >
      Sync
    </button>
  );
}

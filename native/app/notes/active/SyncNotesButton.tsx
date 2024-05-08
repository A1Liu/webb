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
  NoteDocData,
  updateNoteDocAsync,
  ZustandIdbNotesStorage,
} from "@/components/state/noteContents";
import { useUserProfile } from "@/components/state/userProfile";
import { useDeviceProfile } from "@/components/state/deviceProfile";
import {
  PermissionResult,
  PermissionSchema,
  PermissionsManager,
} from "@/components/permissions";
import { usePermissionCache } from "@/components/state/permissions";
import { base64ToBytes, bytesToBase64 } from "@/components/util";
import { maxBy } from "lodash";
import * as automerge from "@automerge/automerge";

const NoteMetadataWithHashSchema = z.object({ note: NoteDataSchema });

const SYNC_STATUS_TOAST_ID = "sync-status-toast-id";
const ACTIVE_SYNC_STATUS_TOAST_ID = "active-sync-status-toast-id";

export const NoteDataFetch = registerRpc({
  name: "NoteDataFetch",
  group: NotesSyncInitGroup,
  input: z.object({ noteId: z.string(), permission: PermissionSchema }),
  output: z.object({ noteId: z.string(), textData: z.string() }),
  rpc: async function* (peerId, { noteId, permission }) {
    console.debug(`received NoteDataFetch req`, peerId);

    const { notes } = useNotesState.getState();
    const noteMetadata = notes.get(noteId);
    if (!noteMetadata) return;

    const { userProfile } = useUserProfile.getState();
    if (!userProfile) return;

    const { deviceProfile } = useDeviceProfile.getState();
    if (!deviceProfile) return;

    const { permissionCache, cb: permCb } = usePermissionCache.getState();
    const permissions = new PermissionsManager(
      deviceProfile.id,
      userProfile.publicAuthUserId,
      permissionCache,
    );

    const verifyResult = await permissions.verifyPermission(
      permission,
      {
        deviceId: peerId,
        userId: userProfile.publicAuthUserId,
        actionId: ["updateNote"],
        resourceId: [noteId],
      },
      {
        id: userProfile.publicAuthUserId,
        publicKey: userProfile.publicAuthKey,
      },
    );
    permCb.updateCache(permissions.permissionCache);

    switch (verifyResult) {
      case PermissionResult.Allow:
        break;

      default:
        toast.error(`Data fetch unauthorized ${verifyResult}`);
        return;
    }

    const output = await ZustandIdbNotesStorage.getItem(noteId);
    if (!output) return;

    const textData = bytesToBase64(automerge.save(output.state.doc));
    yield { noteId, textData };
  },
});

const NotePushListener = registerListener({
  channel: "NotePushListener",
  group: NotesSyncInitGroup,
  schema: z.object({
    notes: NoteMetadataWithHashSchema.array(),
    permission: PermissionSchema,
  }),
  listener: async (peerId, { notes, permission }) => {
    const { userProfile } = useUserProfile.getState();
    if (!userProfile) {
      console.debug(`Device has no user, refusing to sync`);
      return;
    }

    const { deviceProfile } = useDeviceProfile.getState();
    if (!deviceProfile) {
      console.debug(`Device has no user, refusing to sync`);
      return;
    }

    const { permissionCache, cb: permCb } = usePermissionCache.getState();
    const permissions = new PermissionsManager(
      deviceProfile.id,
      userProfile.publicAuthUserId,
      permissionCache,
    );

    const verifyResult = await permissions.verifyPermission(
      permission,
      {
        deviceId: peerId,
        userId: userProfile.publicAuthUserId,
        actionId: ["pushNoteData"],
        resourceId: [],
      },
      {
        id: userProfile.publicAuthUserId,
        publicKey: userProfile.publicAuthKey,
      },
    );
    permCb.updateCache(permissions.permissionCache);

    switch (verifyResult) {
      case PermissionResult.Allow:
        break;

      default:
        toast.error(`Sync request unauthorized ${verifyResult}`);
        return;
    }

    console.debug(`received NotePush req`);
    toast.loading(`Syncing ... writing notes`, {
      id: SYNC_STATUS_TOAST_ID,
    });

    const { notes: prevNotes, cb } = useNotesState.getState();

    let written = 0;

    cb.updateNotesFromSync(notes.map(({ note }) => note));
    for (const { note } of notes) {
      const md5ContentHash = prevNotes.get(note.id)?.md5ContentHash;
      if (md5ContentHash && md5ContentHash === note.md5ContentHash) {
        continue;
      }

      toast.loading(`Syncing - updating notes (${++written})`, {
        id: SYNC_STATUS_TOAST_ID,
      });

      const permission = permissions.findMyPermission({
        actionId: ["updateNote"],
        resourceId: [note.id],
      });

      if (!permission) {
        toast.error(`No permission to read data`, {
          id: "push-data-fetch-fail",
        });
        continue;
      }

      const dataFetchResult = NoteDataFetch.call(peerId, {
        noteId: note.id,
        permission,
      });

      for await (const item of dataFetchResult) {
        const { noteId, textData } = item;
        const doc = automerge.load<{ contents: automerge.Text }>(
          new Uint8Array(base64ToBytes(textData)),
        );

        await updateNoteDocAsync(noteId, doc);
      }
    }

    console.debug(`executed NotePush`);
    toast.success(`Sync complete!`, {
      id: SYNC_STATUS_TOAST_ID,
    });
  },
});

async function* listNoteMetadataUpdateHashes() {
  for (const note of useNotesState.getState().notes.values()) {
    if (!note.md5ContentHash) {
      await ZustandIdbNotesStorage.getItem(note.id);
    }
  }

  for await (const note of useNotesState.getState().notes.values()) {
    const md5ContentHash = note.isTombstone ? "TOMBSTONE" : note.md5ContentHash;

    yield { ...note, md5ContentHash };
  }
}

const NoteListMetadata = registerRpc({
  name: "NoteListMetadata",
  group: NotesSyncInitGroup,
  input: z.object({}),
  output: NoteMetadataWithHashSchema,
  rpc: async function* (peerId, {}) {
    console.debug(`received NoteListMetadata req`, peerId);
    for await (const note of listNoteMetadataUpdateHashes()) {
      yield { note };
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

  const { permissionCache, cb: permsCb } = usePermissionCache.getState();
  const permissions = new PermissionsManager(
    deviceProfile.id,
    userProfile?.publicAuthUserId,
    permissionCache,
  );

  const permission = await permissions.createPermission(
    {
      deviceId: [{ __typename: "Exact", value: deviceProfile.id }],
      userId: [{ __typename: "Exact", value: userProfile.publicAuthUserId }],
      resourceId: [{ __typename: "AnyRemainingSlots" }],
      actionId: [{ __typename: "AnyRemainingSlots" }],
      allow: true,
    },
    "userRoot",
    {
      id: userProfile.publicAuthUserId,
      publicKey: userProfile.publicAuthKey,
      privateKey: userSecret.privateAuthKey,
    },
  );
  permsCb.updateCache(permissions.permissionCache);

  if (!permission) {
    toast.error(`Failed to create permission!`);
    return;
  }

  console.debug("Sync starting...");
  toast.loading(`Syncing ... fetching notes`, {
    id: ACTIVE_SYNC_STATUS_TOAST_ID,
  });

  const { cb } = useNotesState.getState();
  interface NoteSyncState {
    md5ContentHash: string;
    localVersion?: NoteData;
    versions: { peerId?: string; md5ContentHash: string; note: NoteData }[];
  }

  const noteVersions = new Map<string, NoteSyncState>();
  const existingNoteMetadata = new Map<string, NoteData>();
  for await (const note of listNoteMetadataUpdateHashes()) {
    const md5ContentHash = note.md5ContentHash;
    if (!md5ContentHash) continue;

    existingNoteMetadata.set(note.id, note);

    noteVersions.set(note.id, {
      md5ContentHash,
      localVersion: note,
      versions: [{ note, md5ContentHash }],
    });
  }

  let totalCount = 0;
  for (const peer of peers.values()) {
    const stream = NoteListMetadata.call(peer.id, {});
    for await (const { note } of stream) {
      const md5ContentHash = note.md5ContentHash;
      if (!md5ContentHash) continue;

      const { versions } = getOrCompute(noteVersions, note.id, () => ({
        md5ContentHash,
        versions: [],
      }));

      versions.push({ peerId: peer.id, note, md5ContentHash });

      toast.loading(`Syncing ... fetching notes (${++totalCount})`, {
        id: ACTIVE_SYNC_STATUS_TOAST_ID,
      });
    }
  }

  const notesToUpdate = [];
  for (const [_noteId, { localVersion, versions }] of noteVersions.entries()) {
    const mostRecentNote =
      maxBy(versions, (version) => version.note.lastUpdateDate)?.note ??
      localVersion;
    if (!mostRecentNote) continue;

    notesToUpdate.push(mostRecentNote);
  }
  cb.updateNotesFromSync(notesToUpdate);

  for (const note of notesToUpdate) {
    if (note.isTombstone) continue;

    const prevNote = existingNoteMetadata.get(note.id);
    if (prevNote?.md5ContentHash === note.md5ContentHash) continue;

    toast.loading(`Syncing ... writing notes (${++totalCount})`, {
      id: ACTIVE_SYNC_STATUS_TOAST_ID,
    });

    const localDoc = await ZustandIdbNotesStorage.getItem(note.id);
    let doc = localDoc?.state.doc;

    for (const peer of peers.values()) {
      const result = NoteDataFetch.call(peer.id, {
        noteId: note.id,
        permission,
      });

      for await (const item of result) {
        const { textData } = item;
        const remoteDoc = automerge.load<NoteDocData>(
          new Uint8Array(base64ToBytes(textData)),
        );

        if (!doc) {
          doc = remoteDoc;
          continue;
        }
        doc = automerge.merge(doc, remoteDoc);
      }
    }

    if (doc) await updateNoteDocAsync(note.id, doc);
  }

  console.debug(`Finalized ${notesToUpdate.length} notes`);
  toast.loading(`Syncing ... resolved ${notesToUpdate.length} notes`, {
    id: ACTIVE_SYNC_STATUS_TOAST_ID,
  });

  for (const [peerId, _peer] of peers.entries()) {
    await NotePushListener.send(peerId, {
      permission,
      notes: notesToUpdate.map((note) => ({
        note,
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

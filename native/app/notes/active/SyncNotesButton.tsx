import React from "react";
import { useLockFn, useRequest } from "ahooks";
import { usePlatform } from "@/components/hooks/usePlatform";
import { z } from "zod";
import toast from "react-hot-toast";
import { Struct, getOrCompute } from "@a1liu/webb-tools/util";
import {
  NoteData,
  NoteDataSchema,
  NotesSyncInitGroup,
  useNotesState,
} from "@/components/state/notes";
import { usePeers } from "@/components/state/peers";
import { registerListener, registerRpcHandler } from "@/components/network";
import {
  NoteDoc,
  NoteDocData,
  updateNoteDocAsync,
  ZustandIdbNotesStorage,
} from "@/components/state/noteContents";
import { useUserProfile } from "@/components/state/userProfile";
import { useDeviceProfile } from "@/components/state/deviceProfile";
import {
  MatchPerms,
  PermissionResult,
  PermissionSchema,
} from "@/components/permissions";
import { usePermissionCache } from "@/components/state/permissions";
import { base64ToBytes, bytesToBase64 } from "@/components/util";
import { isEqual, maxBy } from "lodash";
import * as automerge from "@automerge/automerge";
import _ from "lodash";
import { Button } from "@/components/design-system/Button";
import { FileActions } from "@a1liu/webb-fs";
import { NetworkLayer } from "@a1liu/webb-tools/network";

const NoteMetadataWithHashSchema = z.object({
  note: NoteDataSchema,
  permission: PermissionSchema,
});

const SYNC_STATUS_TOAST_ID = "sync-status-toast-id";
const ACTIVE_SYNC_STATUS_TOAST_ID = "active-sync-status-toast-id";

export const NoteDataFetch = registerRpcHandler({
  group: NotesSyncInitGroup,
  rpc: NetworkLayer.createRpc({
    name: "NoteDataFetch",
    input: z.object({ noteId: z.string(), permission: PermissionSchema }),
    output: z.object({ noteId: z.string(), textData: z.string() }),
  }),
  handler: async function* (peerId, { noteId, permission }) {
    console.debug(`received NoteDataFetch req`, peerId);

    const { notes } = useNotesState.getState();
    const { cb: permCb } = usePermissionCache.getState();

    const result = Struct.allNotNil({
      noteMetadata: notes.get(noteId),
      userProfile: useUserProfile.getState().userProfile,
    });
    if (!result.ok) return;

    const { userProfile, noteMetadata } = result.data;

    const verifyResult = await permCb.verifyPermissions(
      permission,
      {
        deviceId: peerId,
        userId: userProfile.id,
        actionId: FileActions.update,
        resourceId: [...noteMetadata.folder, noteId],
      },
      userProfile,
    );

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
    notes: z.object({ note: NoteDataSchema }).array(),
    permission: PermissionSchema,
  }),
  listener: async (peerId, { notes, permission }) => {
    const nilCheck = Struct.allNotNil({
      userProfile: useUserProfile.getState().userProfile,
      deviceProfile: useDeviceProfile.getState().deviceProfile,
    });
    if (!nilCheck.ok) {
      console.debug(`Sync missing config: ${nilCheck.missing.join(",")}`);
      return;
    }
    const { userProfile, deviceProfile } = nilCheck.data;

    const { cb: permCb } = usePermissionCache.getState();
    const verifyResult = await permCb.verifyPermissions(
      permission,
      {
        deviceId: peerId,
        userId: userProfile.id,
        actionId: FileActions.update,
        resourceId: [],
      },
      userProfile,
    );

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
    cb.updateNotesFromSync(notes.map(({ note }) => note));

    let written = 0;
    for (const { note } of notes) {
      const prevHeads = prevNotes.get(note.id)?.commitHeads;
      if (isEqual(prevHeads, note.commitHeads)) {
        continue;
      }

      toast.loading(`Syncing - updating notes (${++written})`, {
        id: SYNC_STATUS_TOAST_ID,
      });

      const permission = permCb.findPermission({
        deviceId: deviceProfile.id,
        userId: userProfile.id,
        actionId: FileActions.update,
        resourceId: [...note.folder, note.id],
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
        const doc = automerge.load<NoteDoc>(
          new Uint8Array(base64ToBytes(textData)),
        );

        await updateNoteDocAsync(noteId, doc);
      }
    }

    console.debug(`executed NotePush`);
    toast.success(`Synced ${written} notes!`, {
      id: SYNC_STATUS_TOAST_ID,
    });
  },
});

async function* listNoteMetadataUpdateHashes() {
  for await (const note of [...useNotesState.getState().notes.values()]) {
    yield note;
  }
}

const NoteListMetadata = registerRpcHandler({
  group: NotesSyncInitGroup,
  rpc: NetworkLayer.createRpc({
    name: "NoteListMetadata",
    input: z.object({}),
    output: NoteMetadataWithHashSchema,
  }),
  handler: async function* (peerId, {}) {
    const nilCheck = Struct.allNotNil({
      userProfile: useUserProfile.getState().userProfile,
      deviceProfile: useDeviceProfile.getState().deviceProfile,
    });
    if (!nilCheck.ok) {
      console.debug(`Sync missing config: ${nilCheck.missing.join(",")}`);
      return;
    }
    const { userProfile, deviceProfile } = nilCheck.data;
    const { cb } = usePermissionCache.getState();
    console.debug(`received NoteListMetadata req`, peerId);

    for await (const note of listNoteMetadataUpdateHashes()) {
      const perm = cb.findPermission({
        deviceId: deviceProfile.id,
        userId: userProfile.id,
        actionId: FileActions.read,
        resourceId: [...note.folder, note.id],
      });
      if (!perm) {
        continue;
      }

      yield { note, permission: perm };
    }
  },
});

async function syncNotes() {
  const userProfileNullable = useUserProfile.getState().userProfile;
  const nilCheck = Struct.allNotNil({
    userProfile: userProfileNullable,
    userSecret: userProfileNullable?.secret,
    deviceProfile: useDeviceProfile.getState().deviceProfile,
    peers: usePeers.getState().peers,
  });
  if (!nilCheck.ok) {
    console.debug(`SYNC_NOTES missing config: ${nilCheck.missing.join(",")}`);
    return;
  }

  const { userProfile, userSecret, deviceProfile, peers } = nilCheck.data;
  const { cb: permsCb } = usePermissionCache.getState();

  const permission = await permsCb.createPermission(
    {
      deviceId: [MatchPerms.exact(deviceProfile.id)],
      userId: [MatchPerms.exact(userProfile.id)],
      resourceId: [MatchPerms.AnyRemaining],
      actionId: [MatchPerms.AnyRemaining],
      allow: true,
    },
    "userRoot",
    { ...userProfile, ...userSecret },
  );

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
    versions: { peerId?: string; note: NoteData }[];
  }

  const noteVersions = new Map<string, NoteSyncState>();
  const existingNoteMetadata = new Map<string, NoteData>();
  for await (const note of listNoteMetadataUpdateHashes()) {
    existingNoteMetadata.set(note.id, note);

    noteVersions.set(note.id, { versions: [{ note }] });
  }

  let totalCount = 0;
  for (const peer of peers.values()) {
    const stream = NoteListMetadata.call(peer.deviceId, {});

    // TODO: Check that permissions are properly sent over

    for await (const { note, permission } of stream) {
      const permissionResult = await permsCb.verifyPermissions(
        permission,
        {
          deviceId: peer.deviceId,
          userId: userProfile.id,
          actionId: FileActions.update,
          resourceId: [...note.folder, note.id],
        },
        userProfile,
      );
      if (permissionResult !== PermissionResult.Allow) {
        continue;
      }

      const { versions } = getOrCompute(noteVersions, note.id, () => ({
        versions: [],
      }));

      versions.push({ peerId: peer.deviceId, note });

      toast.loading(`Syncing ... fetching notes (${++totalCount})`, {
        id: ACTIVE_SYNC_STATUS_TOAST_ID,
      });
    }
  }

  const notesToUpdate = [];
  for (const [_noteId, { versions }] of noteVersions.entries()) {
    const mostRecentNote = maxBy(
      versions,
      (version) => version.note.lastUpdateDate,
    )?.note;
    if (!mostRecentNote) continue;

    const note = mostRecentNote;
    if (note.isTombstone) {
      notesToUpdate.push(mostRecentNote);
      continue;
    }

    const allNotesEqualHeads = versions.every((v) =>
      isEqual(mostRecentNote.commitHeads, v.note.commitHeads),
    );
    if (allNotesEqualHeads && existingNoteMetadata.has(note.id)) {
      continue;
    }

    toast.loading(`Syncing ... writing notes (${++totalCount})`, {
      id: ACTIVE_SYNC_STATUS_TOAST_ID,
    });

    const localDoc = await ZustandIdbNotesStorage.getItem(note.id);
    let doc = localDoc?.state.doc;

    for (const peer of peers.values()) {
      const result = NoteDataFetch.call(peer.deviceId, {
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

    if (doc) {
      await updateNoteDocAsync(note.id, doc);
    }

    notesToUpdate.push({
      ...mostRecentNote,
      commitHeads: doc ? automerge.getHeads(doc) : mostRecentNote.commitHeads,
    });
  }
  cb.updateNotesFromSync(notesToUpdate);

  console.debug(`Finalized ${notesToUpdate.length} notes`);
  toast.loading(`Syncing ... resolved ${notesToUpdate.length} notes`, {
    id: ACTIVE_SYNC_STATUS_TOAST_ID,
  });

  for (const [peerId, _peer] of peers.entries()) {
    await NotePushListener.send(peerId, {
      permission,
      notes: [...useNotesState.getState().notes.values()].map((note) => ({
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
    <Button
      size="xs"
      disabled={!peers.size || !userProfile || loading}
      onClick={() => {
        runSynchronization();
      }}
    >
      Sync
    </Button>
  );
}

import { z } from "zod";
import {
  Action,
  Permission,
  PermissionResult,
  PermissionSchema,
} from "@a1liu/webb-tools/permissions";
import { NetworkLayer } from "@a1liu/webb-tools/network";
import { getOrCompute } from "@a1liu/webb-tools/util";

/*
 * FileMetadata
 * - See schema below
 *
 * Actions
 * - Write - Update metadata update contents. Also, creating files
 * - Read - Read contents, metadata
 */

export type FileMetadata = z.infer<typeof FileMetadataSchema>;
export const FileMetadataSchema = z.object({
  // UUID of the file.
  // !! IMMUTABLE !!
  uuid: z.string(),

  // Creation time of the file.
  // !! IMMUTABLE !!
  creationDate: z.coerce.date(),

  // Resolution algorithm. Determines how to resolve conflicts between two peers
  // with different data. Eventually this should be a string, and resolution
  // algorithms should be plugin-based.
  // !! IMMUTABLE !!
  // resolutionAlgorithm: z.nativeEnum(ResolutionAlgorithm),

  // Path of the file. The easiest default is to simply use the uuid. This is
  // what the permissions will match against.
  //
  // Use the path from the most recent `updateTime`
  path: z.string().min(1).array().nonempty(),

  // The last time this file was updated. Should be an ISO-formatted string.
  //
  // Always just use the latest date during merging.
  lastUpdateDate: z.coerce.date(),

  // The last time this file's content was updated. Should be an ISO-formatted string.
  //
  // Always just use the latest date during merging.
  lastContentUpdateDate: z.coerce.date(),

  // When this file will stop being valid. Not all files will have an expiration
  // date. When deleting files, we simply write an expiration date to the file,
  // and then once it actually expires we delete the file.
  //
  // If the most recent update time has a null expiration, use null; otherwise,
  // use the latest expiration date.
  expiration: z.coerce.date().nullish().default(null),

  // SHA-2 hash of the contents of the file. Used to short-circuit edits.
  // After resolution, this gets updated to be the sha-2 of the most recent contents.
  contentHash: z.string(),
});

export const FileNetworkActions = {
  fetch: NetworkLayer.createRpc({
    name: "FileFetch",
    input: z.object({}),
    output: z.object({}),
  }),
  pushMetadataUpdates: { name: "FilePushMetadataUpdates" },
  listMetadata: NetworkLayer.createRpc({
    name: "FileListMetadata",
    input: z.object({}),
    output: z.object({
      file: FileMetadataSchema,
      permission: PermissionSchema.optional(),
    }),
  }),
} as const;

// Add simpler functions first, before working on storage/etc
export async function synchronousFileUpdate({
  network,
  myDeviceId,
  deviceIds,
  listNoteMetadataUpdateHashes,
}: {
  myDeviceId: string;
  deviceIds: string[];
  syncPermission: Permission;
  privateKey: CryptoKey;
  network: NetworkLayer;
  verifyPermissions: (
    permission: Permission,
    action: Action,
  ) => Promise<PermissionResult>;
  listNoteMetadataUpdateHashes: () => AsyncGenerator<FileMetadata>;
}) {
  // TODO: Perm init?

  const noteVersions = new Map<string, Map<string, FileMetadata>>();
  for await (const file of listNoteMetadataUpdateHashes()) {
    noteVersions.set(file.uuid, new Map([[myDeviceId, file]]));
  }

  // Fetch all available metadata
  for (const deviceId of deviceIds) {
    const metadata = FileNetworkActions.listMetadata.call(
      network,
      deviceId,
      {},
    );
    for await (const result of metadata) {
      if (!result.success) continue;
      const { file, permission: _perm } = result.data;

      // TODO: test permission

      getOrCompute(noteVersions, file.uuid, () => new Map()).set(
        myDeviceId,
        file,
      );
    }
  }

  // Sync notes
  for (const [_noteId, notesByPeer] of noteVersions.entries()) {
    const notes = [...notesByPeer.values()];
    const { ...mostRecentNote } = notes.reduce(
      (left: FileMetadata, right: FileMetadata): FileMetadata => {
        if (!left) return right;
        if (left.lastUpdateDate < right.lastUpdateDate) return right;

        return left;
      },
    );
    if (!mostRecentNote) continue;

    if (mostRecentNote.expiration) {
      mostRecentNote.expiration = notes.reduce(
        (date: Date | null, file: FileMetadata): Date | null => {
          if (!file.expiration || !date) return date ?? file.expiration;
          if (date > file.expiration) return date;
          return file.expiration;
        },
        null,
      );
    }
  }
}

/* Synchronous version of file update protocol, slow:
 *
 * - User-triggered
 * - Single peer does synchronizing
 * - Exchange all metadata
 * - Check permissions of all peers for all files
 * - Merge metadata of files with valid permissions
 *   - exchange metadata of files which do not need a content hash update
 * - Exchange contents for files which need content merging
 * - Perform content merging
 * - Compute hash
 * - Send updated contents & hash to peers
 */

export const FileActions = {
  update: ["webb", "fs", "update"],
  create: ["webb", "fs", "create"],
  read: ["webb", "fs", "read"],
} as const;

import { z } from "zod";

/*
 * FileMetadata
 * - See schema below
 *
 * Actions
 * - Write - Update metadata update contents. Also, creating files
 * - Read - Read contents, metadata
 */

export enum ResolutionAlgorithm {
  YataCrdt = "YATA_CRDT",
  ReadOnly = "READ_ONLY",
}

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
  resolutionAlgorithm: z.nativeEnum(ResolutionAlgorithm),

  // Path of the file. The easiest default is to simply use the uuid. This is
  // what the permissions will match against.
  //
  // Use the path from the most recent `updateTime`
  path: z.string().min(1).array().nonempty(),

  // The last time this file was updated. Should be an ISO-formatted string.
  //
  // Always just use the latest date during merging.
  lastUpdateDate: z.coerce.date(),

  // When this file will stop being valid. Not all files will have an expiration
  // date. When deleting files, we simply write an expiration date to the file,
  // and then once it actually expires we delete the file.
  //
  // If the most recent update time has a null expiration, use null; otherwise,
  // use the latest expiration date.
  expiration: z.coerce.date().nullish(),

  // SHA-2 hash of the contents of the file. Used to short-circuit edits.
  // After resolution, this gets updated to be the sha-2 of the most recent contents.
  contentHash: z.string(),
});


// Add simpler functions first, before working on storage/etc

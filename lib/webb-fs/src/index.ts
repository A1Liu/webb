import { z } from "zod";
import { Observable } from "./util";
import { IndexedDbStore } from "./store";

export enum ResolutionAlgorithm {
  YataCrdt = "YATA_CRDT",
  ReadOnly = "READ_ONLY",
}

export type FileMetadata = z.infer<typeof FileMetadataSchema>;
export const FileMetadataSchema = z.object({
  // UUID of the file.
  // !! IMMUTABLE !!
  uuid: z.string(),

  // Resolution algorithm. Determines how to resolve conflicts between two peers
  // with different data. Eventually this should be a string, and resolution
  // algorithms should be plugin-based.
  // !! IMMUTABLE !!
  resolutionAlgorithm: z.nativeEnum(ResolutionAlgorithm),

  // Path of the file. The easiest default is to simply use the uuid. This is
  // what the permissions will match against.
  path: z.string().min(1).array().nonempty(),

  // The last time this file was updated
  lastUpdateDate: z.coerce.date(),

  // When this file will stop being valid. Not all files will have an expiration
  // date. When deleting files, we simply write an expiration date to the file,
  // and then once it actually expires we delete the file.
  expiration: z.coerce.date().nullish(),
});

// Maybe this should still be in zustand?
// We can make zustand use a better persistence layer maybe

export class FileMetadataStore {
  private readonly inMemoryCache: Map<string, FileMetadata> = new Map();
  private readonly persistentStore: IndexedDbStore<FileMetadata>;
  private readonly cacheHydration: Promise<void>;
  readonly observable: Observable;
  private readonly pushUpdate: () => void;

  constructor(
    dbName: string = "webb-tools",
    storeName: string = "FileMetadataStore",
  ) {
    const persistentStore = new IndexedDbStore<FileMetadata>(dbName, storeName);
    this.persistentStore = persistentStore;
    this.cacheHydration = (async () => {
      for await (const [, file] of persistentStore) {
        this.inMemoryCache.set(file.uuid, file);
      }
    })();

    [this.pushUpdate, this.observable] = Observable.create();
  }

  getNote(id: string) {}

  *[Symbol.iterator](): Iterator<FileMetadata> {
    for (const file of this.inMemoryCache.values()) {
      yield file;
    }
  }
}

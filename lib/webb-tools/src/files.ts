import { z } from "zod";
import { Observable } from "./util";
import { IndexedDbStore } from "./store";

export enum ResolutionAlgorithm {
  YataCrdt = "YATA_CRDT",
  ReadOnly = "READ_ONLY",
}

export type FileMetadata = z.infer<typeof FileMetadataSchema>;
export const FileMetadataSchema = z.object({
  id: z.string(),
  folder: z.string().array().default([]),
  lastUpdateDate: z.coerce.date(),
  expiration: z.coerce.date().nullish(),
  resolutionAlgorithm: z.nativeEnum(ResolutionAlgorithm),
});

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
        this.inMemoryCache.set(file.id, file);
      }
    })();

    [this.pushUpdate, this.observable] = Observable.create();
  }
}

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ZustandIdbStorage } from "../util";
import { GlobalInitGroup } from "../constants";
import {
  PermissionKey,
  PermissionLock,
  PermissionLockHelpers,
} from "../crypto";
import { useUserProfile } from "./userProfile";
import toast from "react-hot-toast";

// Only 1 lock ID for now

interface LockStoreState {
  keyCache: Map<
    string,
    { key: Omit<PermissionKey, "base64Signature">; pass: boolean }
  >;
  locks: Map<string, PermissionLock>;
  cb: {
    getLock: () => PermissionLock;
    createLock: (name: string) => Promise<PermissionLock>;
    addLock: (lock: PermissionLock) => Promise<boolean>;
    verifyKey: (
      key: PermissionKey,
    ) => Promise<{ type: "done"; valid: boolean } | { type: "missingLock" }>;
  };
}

export const useLocks = create<LockStoreState>()(
  persist(
    (set, get) => {
      return {
        keyCache: new Map(),
        locks: new Map(),
        cb: {
          getLock: () => {
            for (const lock of get().locks.values()) {
              return lock;
            }

            // TODO: this is dumb
            throw new Error("No locks!");
          },
          createLock: async (name) => {
            const userProfile = useUserProfile.getState().userProfile;
            if (!userProfile) {
              const message = `Can't create lock ${name}, not logged in!`;
              toast.error(message);
              throw new Error(message);
            }

            const privateKey = userProfile.secret?.privateAuthKey;
            if (!privateKey) {
              const message = `Can't create lock ${name}, missing secret!`;
              toast.error(message);
              throw new Error(message);
            }

            const lock = await PermissionLockHelpers.createLock(
              name,
              privateKey,
            );

            set((prev) => {
              const newLocks = new Map(prev.locks);
              newLocks.set(lock.id, lock);
              return { locks: newLocks };
            });

            return lock;
          },
          addLock: async (lock) => {
            const userProfile = useUserProfile.getState().userProfile;
            if (!userProfile) {
              const message = `Can't add lock ${name}, not logged in!`;
              toast.error(message);
              throw new Error(message);
            }

            const pass = await PermissionLockHelpers.verifyLock(
              lock,
              userProfile.publicAuthKey,
            );
            if (!pass) {
              const message = `Lock ${name} failed to verify`;
              toast.error(message);
              return false;
            }

            set((prev) => {
              const newLocks = new Map(prev.locks);
              newLocks.set(lock.id, lock);
              return { locks: newLocks };
            });

            return true;
          },
          verifyKey: async (key) => {
            const { locks, keyCache } = get();
            const cachedKey = keyCache.get(key.keyId);
            if (
              !!cachedKey &&
              cachedKey.key.lockId === key.lockId &&
              cachedKey.key.deviceId === key.deviceId &&
              cachedKey.key.expirationDate === key.expirationDate
            ) {
              return { type: "done", valid: cachedKey.pass };
            }
            const lock = locks.get(key.lockId);
            if (!lock) {
              return { type: "missingLock" };
            }

            const pass = await PermissionLockHelpers.unlock(lock, key);

            const newKeyCache = new Map(keyCache);
            newKeyCache.set(key.keyId, {
              pass,
              key: {
                __typename: key.__typename,
                keyId: key.keyId,
                lockId: key.lockId,
                deviceId: key.deviceId,
                expirationDate: key.expirationDate,
              },
            });
            set({
              keyCache: newKeyCache,
            });

            return { type: "done", valid: pass };
          },
        },
      };
    },
    {
      name: "lock-storage",
      storage: ZustandIdbStorage,
      skipHydration: true,
      partialize: ({ cb, ...rest }) => ({
        ...rest,
      }),
    },
  ),
);

GlobalInitGroup.registerInit("LockStoreState", () => {
  useLocks.persist.rehydrate();
});

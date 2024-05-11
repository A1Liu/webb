import { z } from "zod";
import { create } from "zustand";
import { persist, PersistStorage } from "zustand/middleware";
import { GlobalInitGroup } from "../constants";
import {
  createUserKeys,
  exportUserPublickKey,
  importUserPublicKey,
} from "../crypto";
import { base64ToBytes, bytesToBase64, ZustandIdbStorage } from "../util";

const IDB_KEY = "user-profile-storage";
const VERSION = 0;

export type UserProfileSerialized = z.infer<typeof UserProfileSerializedSchema>;
export const UserProfileSerializedSchema = z.object({
  publicAuthUserId: z.string(),
  publicAuthKey: z.string(),
  secret: z
    .object({
      privateAuthKey: z.string(),
    })
    .optional(),
});

export interface UserProfile {
  id: string;
  publicKey: CryptoKey;

  secret?: {
    privateKey: CryptoKey;
  };
}

async function deserializeUserProfile(userProfile: UserProfileSerialized) {
  const publicKey = await importUserPublicKey(userProfile.publicAuthKey);

  const privateKey = userProfile.secret
    ? await window.crypto.subtle.importKey(
        "pkcs8",
        base64ToBytes(userProfile.secret.privateAuthKey),
        {
          name: "RSA-PSS",
          hash: "SHA-512",
        },
        true,
        ["sign"],
      )
    : undefined;

  return {
    id: userProfile.publicAuthUserId,
    publicKey: publicKey,
    secret: privateKey ? { privateKey } : undefined,
  };
}

export async function getUserProfileSerialized(): Promise<
  UserProfileSerialized | undefined
> {
  const output = await ZustandIdbStorage.getItem(IDB_KEY);
  if (!output) return undefined;

  const state = z
    .object({ _userProfileSerialized: UserProfileSerializedSchema })
    .safeParse(output?.state);
  if (!state.success) return undefined;

  return state.data._userProfileSerialized;
}

const ZustandIdbUserProfileStorage: PersistStorage<
  Pick<UserProfileState, "userProfile">
> = {
  setItem: async (key, value) => {
    const _userProfileSerialized: UserProfileSerialized | undefined =
      await (async () => {
        const userProfile = value.state.userProfile;
        if (!userProfile) return undefined;
        const pubKey = await exportUserPublickKey(userProfile.publicKey);

        const secret = await (async () => {
          if (!userProfile.secret) return undefined;
          const privAuthKey = await window.crypto.subtle.exportKey(
            "pkcs8",
            userProfile.secret.privateKey,
          );

          return {
            privateAuthKey: bytesToBase64(privAuthKey),
          };
        })();

        return {
          publicAuthUserId: userProfile.id,
          publicAuthKey: pubKey,
          secret,
        };
      })();

    await ZustandIdbStorage.setItem(key, {
      state: { _userProfileSerialized },
      version: VERSION,
    });
  },
  getItem: async (key) => {
    const output = await ZustandIdbStorage.getItem(key);
    if (!output) {
      return null;
    }

    const state = z
      .object({ _userProfileSerialized: UserProfileSerializedSchema })
      .safeParse(output.state);
    if (!state.success) return null;

    const userProfileSerialized = state.data._userProfileSerialized;
    const userProfile = userProfileSerialized
      ? await deserializeUserProfile(userProfileSerialized)
      : undefined;

    return { version: 0, state: { userProfile } };
  },
  removeItem: async (key) => {
    await ZustandIdbStorage.removeItem(key);
  },
};

interface UserProfileState {
  userProfile?: UserProfile;
  cb: {
    updateUserProfile: (useProfile: UserProfile) => void;
    updateUserProfileFromSerialized: (
      userProfile: UserProfileSerialized,
    ) => Promise<void>;
    logout: () => void;
    createUserProfile: () => Promise<void>;
  };
}

export const useUserProfile = create<UserProfileState>()(
  persist(
    (set) => {
      function updateUserProfile(userProfile: UserProfile) {
        set({ userProfile });
      }

      return {
        cb: {
          updateUserProfile,
          updateUserProfileFromSerialized: async (serialized) => {
            const userProfile = await deserializeUserProfile(serialized);
            set({ userProfile });
          },
          logout: () => set({ userProfile: undefined }),
          createUserProfile: async () => {
            const keys = await createUserKeys();

            const userProfile: UserProfile = {
              id: keys.publicAuthUserId,
              publicKey: keys.publicAuthKey,
              secret: {
                // TODO: store this stuff in a separate store
                privateKey: keys.privateAuthKey,
              },
            };

            updateUserProfile(userProfile);
          },
        },
      };
    },
    {
      name: IDB_KEY,
      storage: ZustandIdbUserProfileStorage,
      skipHydration: true,
      partialize: ({ cb, ...rest }) => ({ ...rest }),
    },
  ),
);

GlobalInitGroup.registerValue({
  field: "UserProfile",
  eagerInit: true,
  create: () => {
    useUserProfile.persist.rehydrate();
    return useUserProfile;
  },
});

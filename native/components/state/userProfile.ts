import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { GlobalInitGroup } from "../constants";
import {
  createUserKeys,
  exportUserPublickKey,
  importUserPublicKey,
} from "../crypto";
import { base64ToBytes, bytesToBase64, ZustandIdbStorage } from "../util";

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
  publicAuthUserId: string;
  publicAuthKey: CryptoKey;

  secret?: {
    privateAuthKey: CryptoKey;
  };
}

interface UserProfileState {
  _userProfileSerialized?: UserProfileSerialized;
  userProfile?: UserProfile;
  cb: {
    updateUserProfile: (useProfile: UserProfile) => Promise<void>;
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
      return {
        cb: {
          updateUserProfile: async (userProfile) => {
            const pubKey = await exportUserPublickKey(
              userProfile.publicAuthKey,
            );
            const secret = await (async () => {
              if (!userProfile.secret) return undefined;
              const privAuthKey = await window.crypto.subtle.exportKey(
                "pkcs8",
                userProfile.secret.privateAuthKey,
              );

              return {
                privateAuthKey: bytesToBase64(privAuthKey),
              };
            })();

            set({
              userProfile,
              _userProfileSerialized: {
                publicAuthUserId: userProfile.publicAuthUserId,
                publicAuthKey: pubKey,
                secret,
              },
            });
          },
          updateUserProfileFromSerialized: async (userProfile) => {
            const publicKey = await importUserPublicKey(
              userProfile.publicAuthKey,
            );

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

            set({
              _userProfileSerialized: userProfile,
              userProfile: {
                publicAuthUserId: userProfile.publicAuthUserId,
                publicAuthKey: publicKey,
                secret: privateKey ? { privateAuthKey: privateKey } : undefined,
              },
            });
          },
          logout: () => {
            set({ userProfile: undefined, _userProfileSerialized: undefined });
          },
          createUserProfile: async () => {
            const keys = await createUserKeys();

            const userProfile: UserProfile = {
              publicAuthUserId: keys.publicAuthUserId,
              publicAuthKey: keys.publicAuthKey,
              secret: {
                // TODO: store this stuff in a separate store
                privateAuthKey: keys.privateAuthKey,
              },
            };
            set({ userProfile });
          },
        },
      };
    },
    {
      name: "user-profile-storage",
      storage: ZustandIdbStorage,
      skipHydration: true,
      partialize: ({ cb, userProfile, ...rest }) => ({ ...rest }),
      onRehydrateStorage: (state) => {
        return async (newState) => {
          if (newState?._userProfileSerialized) {
            await state.cb.updateUserProfileFromSerialized(
              newState._userProfileSerialized,
            );
          }
        };
      },
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

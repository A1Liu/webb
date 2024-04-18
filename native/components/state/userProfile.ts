import { create } from "zustand";
import { persist } from "zustand/middleware";
import { GlobalInitGroup } from "../constants";
import { createUserKeys } from "../crypto";
import { ZustandIdbStorage } from "../util";

export interface UserProfile {
  publicAuthUserId: string;
  publicAuthKey: CryptoKey;

  secret?: {
    privateAuthKey: CryptoKey;
    privateEncryptKey: CryptoKey;
  };
}

interface UserProfileState {
  userProfile?: UserProfile;
  cb: {
    updateUserProfile: (useProfile: UserProfile) => void;
    logout: () => void;
    createUserProfile: () => Promise<void>;
  };
}

export const useUserProfile = create<UserProfileState>()(
  persist(
    (set) => {
      return {
        cb: {
          updateUserProfile: (userProfile) => {
            set({ userProfile });
          },
          logout: () => {
            set({ userProfile: undefined });
          },
          createUserProfile: async () => {
            const keys = await createUserKeys();

            const userProfile: UserProfile = {
              publicAuthUserId: keys.publicAuthUserId,
              publicAuthKey: keys.publicAuthKey,
              secret: {
                // TODO: store this stuff in a separate store
                privateAuthKey: keys.privateAuthKey,
                privateEncryptKey: keys.privateEncryptKey,
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
      partialize: ({ cb, ...rest }) => ({ ...rest }),
    },
  ),
);

GlobalInitGroup.registerInit("UserProfile", () => {
  useUserProfile.persist.rehydrate();
});

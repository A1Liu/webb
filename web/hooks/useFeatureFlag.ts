import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as LDClient from "launchdarkly-js-client-sdk";
import { z } from "zod";
import { omit } from "ramda";

// TODO: parse flags

type FeatureFlag = keyof typeof FeatureFlags;
export type FeatureFlagSchema = {
  [K in FeatureFlag]: (typeof FeatureFlags)[K];
};

const FeatureFlags = {
  field1: z.string(),
  field2: z.boolean(),
} as const;

function getOverrideSetter(
  setter: (f: (prev: FeatureFlagStore) => Partial<FeatureFlagStore>) => void,
) {
  return function setOverride<F extends FeatureFlag>(
    flag: F,
    value: FeatureFlagSchema[F],
  ) {
    setter(({ flagOverrideValues }) => ({
      flagOverrideValues: {
        ...flagOverrideValues,
        [flag]: value,
      },
    }));
  };
}

interface FeatureFlagStore {
  flagValues: Partial<FeatureFlagSchema>;
  flagOverrideValues: Partial<FeatureFlagSchema>;
  operations: {
    setOverride: ReturnType<typeof getOverrideSetter>;
    removeOverride: (f: FeatureFlag) => void;
  };
}

const useFeatureFlagStore = create<FeatureFlagStore>()(
  persist(
    (set) => ({
      flagValues: {},
      flagOverrideValues: {},
      operations: {
        setOverride: getOverrideSetter(set),
        removeOverride: (f: FeatureFlag) =>
          set(({ flagOverrideValues }) => ({
            flagOverrideValues: omit([f], flagOverrideValues),
          })),
      },
    }),
    {
      name: "featureFlags",
      partialize: ({ flagOverrideValues }) => ({ flagOverrideValues }),
    },
  ),
);

const client = LDClient.initialize("asdfasdf", {}, { streaming: true });

client.on("change", (_f) => {});

interface FeatureFlagResponse<F extends FeatureFlag> {
  flag: F;
  value: FeatureFlagSchema[F] | undefined;
}

export function useFeatureFlag<F extends FeatureFlag>(
  flag: F,
): FeatureFlagResponse<F> {
  const value = useFeatureFlagStore(
    ({ flagValues, flagOverrideValues }) =>
      flagOverrideValues[flag] ?? flagValues[flag],
  );

  return {
    flag,
    value,
  };
}

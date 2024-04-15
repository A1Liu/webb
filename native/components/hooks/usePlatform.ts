import { create } from "zustand";

interface PlatformInfo {
  isMobile: boolean;
}

const usePlatformImpl = create<{ info: PlatformInfo; init: () => void }>(
  (set) => {
    return {
      info: {
        isMobile: false,
      },
      init: () => {
        const info = ((): Omit<PlatformInfo, "cb"> => {
          switch (navigator.platform.toLowerCase()) {
            case "macintel":
              return { isMobile: false };
            case "iphone":
              return { isMobile: true };
            default:
              throw new Error(
                `failed to work on platform: ${navigator.platform}`
              );
          }
        })();

        set({ info });
      },
    };
  }
);

export function usePlatform(): PlatformInfo {
  return usePlatformImpl((s) => s.info);
}

export function doPlatformInit() {
  usePlatformImpl.getState().init();
}

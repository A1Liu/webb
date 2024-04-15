import { create } from "zustand";

enum Platform {
  MacOS = "MacOS",
  IPhone = "iPhone",
}

interface PlatformInfo {
  platform: Platform;
  isMobile: boolean;
}

const usePlatformImpl = create<{ info: PlatformInfo; init: () => void }>(
  (set) => {
    return {
      info: {
        platform: Platform.MacOS,
        isMobile: false,
      },
      init: () => {
        const info = ((): Omit<PlatformInfo, "cb"> => {
          switch (navigator.platform.toLowerCase()) {
            case "macintel":
              return {
                platform: Platform.MacOS,
                isMobile: false,
              };
            case "iphone":
              return {
                platform: Platform.IPhone,
                isMobile: true,
              };
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

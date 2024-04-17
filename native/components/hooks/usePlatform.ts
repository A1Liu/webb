import { create } from "zustand";
import { GlobalInitGroup } from "../constants";

enum Platform {
  MacOS = "MacOS",
  IPhone = "iPhone",
}

interface PlatformInfo {
  platform: Platform;
  isMobile: boolean;
}

export const usePlatform = create<PlatformInfo>(() => {
  return {
    platform: Platform.MacOS,
    isMobile: false,
  };
});

function getPlatformInfo(): Omit<PlatformInfo, "cb"> {
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
      throw new Error(`failed to work on platform: ${navigator.platform}`);
  }
}

GlobalInitGroup.registerValue({
  field: "usePlatform",
  eagerInit: true,
  create: () => {
    const platformInfo = getPlatformInfo();
    usePlatform.setState(platformInfo);

    return usePlatform;
  },
});

export const EnvFlags = {} as const;

// Explicitly declaring the flags on the window interface so that they're editable
declare global {
  interface Window {
    EnvironmentFlags: typeof EnvFlags;
  }
}
if (typeof window !== "undefined") {
  window.EnvironmentFlags = EnvFlags;
}

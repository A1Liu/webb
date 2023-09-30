/* eslint-disable */
// This file was generated by [tauri-specta](https://github.com/oscartbeaumont/tauri-specta). Do not edit this file manually.

declare global {
  interface Window {
    __TAURI_INVOKE__<T>(
      cmd: string,
      args?: Record<string, unknown>
    ): Promise<T>;
  }
}

// Function avoids 'window not defined' in SSR
const invoke = () => window.__TAURI_INVOKE__;

export function runZsh(command: string) {
  return invoke()<CommandId>("run_zsh", { command });
}

export function pollCommand(id: CommandId, timeoutMs: number) {
  return invoke()<CommandOutput | null>("poll_command", { id, timeoutMs });
}

export type CommandOutput = {
  end: boolean;
  status: CommandStatus | null;
  data: CommandData[];
};
export type CommandStatus = { success: boolean; exit_code: number | null };
export type CommandId = string;
export type CommandData =
  | { kind: "Status"; value: CommandStatus }
  | { kind: "Stdout"; value: string }
  | { kind: "Stderr"; value: string };

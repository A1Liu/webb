/* eslint-disable */
// This file was generated by [tauri-specta](https://github.com/oscartbeaumont/tauri-specta). Do not edit this file manually.

declare global {
    interface Window {
        __TAURI_INVOKE__<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
    }
}

// Function avoids 'window not defined' in SSR
const invoke = () => window.__TAURI_INVOKE__;

export function runZsh(config: CommandConfig) {
    return invoke()<CommandId>("run_zsh", { config })
}

export function pollCommand(id: CommandId, timeoutMs: number) {
    return invoke()<CommandOutput | null>("poll_command", { id,timeoutMs })
}

export function suggestPath(s: string, from: string) {
    return invoke()<PathSuggest>("suggest_path", { s,from })
}

export function userHomeDir() {
    return invoke()<string>("user_home_dir")
}

export type CommandOutput = { end: boolean; status: CommandStatus | null; data: CommandData[] }
export type CommandData = { kind: "Status"; value: CommandStatus } | { kind: "Stdout"; value: string } | { kind: "Stderr"; value: string }
export type PathSuggest = { valid: boolean; closest_path: string }
export type CommandStatus = { success: boolean; exit_code: number | null }
export type CommandConfig = { command: string; working_directory: string }
export type CommandId = string

import { invoke } from "@tauri-apps/api/tauri";

export const Handlers = {
  zsh: {
    command: "run_zsh",
  },
} as const;

export interface CommandStatus {
  success: boolean;
  exitCode: number | null;
}

export interface CommandData {
  Stderr?: string;
  Stdout?: string;
}

interface PollResult {
  end: boolean;
  status: CommandStatus | null;
  data: CommandData[];
}

export async function pollCommand(props: {
  id: string;
  timeoutMs: number;
}): Promise<PollResult> {
  return invoke("poll_command", props);
}

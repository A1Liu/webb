<script lang="ts" context="module">
  import type { CellInfo, Sheet } from "./cellStore";
  import { invoke } from "@tauri-apps/api/tauri";

  function matchKey(
    e: KeyboardEvent,
    key: string,
    combo: { meta?: true; shift?: true; ctrl?: true } = {}
  ) {
    if (e.key !== key) return false;
    if (e.metaKey !== !!combo.meta) return false;
    if (e.shiftKey !== !!combo.shift) return false;
    if (e.ctrlKey !== !!combo.ctrl) return false;

    return true;
  }

  function inputHandler(e: Event) {
    if (!e.target) return;

    const target = e.target as HTMLTextAreaElement;

    target.style.minHeight = "0px";
    target.style.minHeight = target.scrollHeight + "px";
  }

  interface CommandOutput {
    cell: CellInfo;
    commandId: Promise<string>;
  }
  function keyHandler(
    e: KeyboardEvent,
    cell: CellInfo
  ): CommandOutput | undefined {
    if (!e.target) return undefined;
    if (e.isComposing || e.keyCode === 229) return undefined;

    if (matchKey(e, "Enter", { shift: true })) return undefined;

    if (
      matchKey(e, "Enter", { meta: true }) ||
      (matchKey(e, "Enter") && cell.contents.split("\n").length <= 1)
    ) {
      e.preventDefault();

      return {
        cell,
        commandId: invoke("run_zsh", {
          command: cell.contents,
        }),
      };
    }
  }
</script>

<script lang="ts">
  import { Terminal } from "xterm";
  import { FitAddon } from "xterm-addon-fit";
  import { onDestroy } from "svelte";
  import {
    pollCommand,
    type CommandData,
    type CommandStatus,
  } from "$lib/handlers";

  const term = new Terminal({
    disableStdin: true,
    convertEol: true,
    rows: 1,
    theme: {
      foreground: "#d2d2d2",
      background: "#2b2b2b",
      cursor: "#adadad",
      black: "#000000",
      red: "#d81e00",
      green: "#5ea702",
      yellow: "#cfae00",
      blue: "#427ab3",
      magenta: "#89658e",
      cyan: "#00a7aa",
      white: "#dbded8",
      brightBlack: "#686a66",
      brightRed: "#f54235",
      brightGreen: "#99e343",
      brightYellow: "#fdeb61",
      brightBlue: "#84b0d8",
      brightMagenta: "#bc94b7",
      brightCyan: "#37e6e8",
      brightWhite: "#f1f1f0",
    },
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  export let sheet: Sheet;
  export let cellId: string;

  let inputRef: HTMLTextAreaElement | null = null;
  let termRef: any = null;
  let commandId: string | null = null;
  let output: {
    uuid: string;
    status: CommandStatus | null;
    data: CommandData[];
  } | null = null;
  let moveDown = false;
  let newlineBuffered = false;

  const listenerDisposerLF = term.onLineFeed(() => {
    if (term.rows < 30) {
      term.resize(term.cols, term.rows + 1);
    }
  });

  async function invokeCommand(commandUuid: string) {
    let timeoutMs = 50;
    while (commandUuid === commandId) {
      const pollOut = await pollCommand({
        id: commandUuid,
        timeoutMs,
      });
      if (!pollOut) {
        timeoutMs *= 2;
        timeoutMs = Math.min(400, timeoutMs);
        continue;
      } else {
        timeoutMs = 50;
      }

      output = {
        uuid: commandUuid,
        status: pollOut.status ?? output?.status ?? null,
        data: [...(output?.data ?? []), ...pollOut.data],
      };

      if (pollOut.end) {
        moveDown = true;
        break;
      }
    }
  }

  $: cellInfo = sheet.cells.get(cellId)!;

  $: if (commandId !== null) invokeCommand(commandId);

  $: if (moveDown) {
    moveDown = false;
    sheet.moveDownFrom($cellInfo.id);
  }

  $: if ($cellInfo.focus && inputRef !== null) {
    inputRef.focus();
    $cellInfo.focus = false;
  }

  $: if (termRef !== null && commandId !== null) {
    newlineBuffered = false;
    term.reset();
    term.resize(term.cols, 1);
    term.open(termRef);
    fitAddon.fit();
    term.write("\x1b[?25l");
  }

  $: if (output !== null && output?.data.length > 0) {
    const textBlocks = output.data.flatMap((data) => {
      const out = [];
      if (data.Stderr) out.push(data.Stderr);
      if (data.Stdout) out.push(data.Stdout);

      return out;
    });

    newlineBuffered = textBlocks.reduce((nl, block) => {
      if (nl) term.write("\n");

      const r = block.endsWith("\n");

      term.write(block.slice(0, block.length - (r ? 1 : 0)));

      return r;
    }, newlineBuffered);

    output = {
      status: output.status,
      uuid: output.uuid,
      data: [],
    };
  }

  onDestroy(() => {
    listenerDisposerLF.dispose();
  });
</script>

<div class="wrapper">
  {#if !cellInfo}
    <textarea disabled />
  {:else}
    <!--
      spellcheck=false prevents the OS from doing stupid stuff like making changing
      consecutive dashes into an em-dash.
    -->
    <textarea
      spellcheck="false"
      bind:this={inputRef}
      bind:value={$cellInfo.contents}
      on:input={inputHandler}
      on:keydown={(e) => {
        const res = keyHandler(e, $cellInfo);
        if (!res) return;

        const { commandId: uuid } = res;
        uuid.then((uuid) => {
          output = { uuid, status: null, data: [] };
          commandId = uuid;
        });
      }}
    />
  {/if}

  {#key output?.uuid}
    {#if output !== null}
      <div class="row">
        {#if output.status === null}
          RUNNING
        {:else if output.status.success}
          SUCCESS
        {:else}
          FAILED
        {/if}
      </div>

      {#if output !== null}
        <div bind:this={termRef} class="terminal" />
      {/if}
    {/if}
  {/key}
</div>

<style>
  .wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.25rem;
    background-color: rgb(128, 128, 128);
    width: 40rem;
  }

  .row {
    display: flex;
    gap: 0.5rem;
  }

  .terminal {
    width: 100%;
  }

  textarea {
    font-family: var(--font-mono);
    width: 100%;
    border: none;
    height: 1.15rem;
    padding: 0px;
    resize: none;
    overflow-y: hidden;
  }
</style>

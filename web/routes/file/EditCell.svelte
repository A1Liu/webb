<script lang="ts" context="module">
  import type { CellInfo, Sheet } from "./cellStore";
  import {
    pollCommand,
    suggestPath,
    runZsh,
    type RunnerOutputExt,
    runLua,
  } from "$lib/handlers";

  function matchKey(
    e: IKeyboardEvent,
    key: string,
    combo: { meta?: true; shift?: true; ctrl?: true } = {}
  ) {
    if (e.code !== key) return false;
    if (e.metaKey !== !!combo.meta) return false;
    if (e.metaKey !== !!combo.meta) return false;
    if (e.shiftKey !== !!combo.shift) return false;
    if (e.ctrlKey !== !!combo.ctrl) return false;

    return true;
  }

  interface HandlerOutput {
    cell: CellInfo;
    result: Promise<
      | { kind: "command"; commandId: string }
      | { kind: "cd"; nextDir: string | null }
    >;
  }

  function submit(cell: CellInfo): HandlerOutput {
    const trimmed = cell.contents.trim();
    if (trimmed.startsWith("cd")) {
      return {
        cell,
        result: suggestPath(trimmed.slice(2).trim(), cell.directory).then(
          ({ valid, closest_path }) => {
            if (valid) {
              return { kind: "cd", nextDir: closest_path };
            }

            return { kind: "cd", nextDir: null };
          }
        ),
      };
    }

    const result = cell.lua
      ? runLua(cell.contents)
      : runZsh({
          command: cell.contents,
          working_directory: cell.directory,
        });

    return {
      cell,
      result: result.then((s) => ({ kind: "command", commandId: s })),
    };
  }

  function shouldSubmitCommand(e: IKeyboardEvent, cell: CellInfo): boolean {
    console.log("key handler");
    if (!e.target) return false;

    if (matchKey(e, "Enter", { shift: true })) return false;

    if (
      matchKey(e, "Enter") &&
      cell.contents.split("\n").length <= 1 &&
      !cell.lua
    ) {
      return true;
    }

    return false;
  }
</script>

<script lang="ts">
  import { Terminal } from "xterm";
  import { FitAddon } from "xterm-addon-fit";
  import { onDestroy } from "svelte";
  import Monaco, { type Editor } from "$lib/Monaco.svelte";
  import { KeyCode, KeyMod } from "monaco-editor";
  import type { IKeyboardEvent } from "monaco-editor";

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

  let termRef: any = null;
  let commandId: string | null = null;
  let output: {
    uuid: string;
    status: boolean | null;
    data: RunnerOutputExt[];
  } | null = null;
  let moveDown = false;
  let nextDir: string | null = null;
  let newlineBuffered = false;

  let editor: Editor | undefined = undefined;

  const listenerDisposerLF = term.onLineFeed(() => {
    if (term.rows < 30) {
      term.resize(term.cols, term.rows + 1);
    }
  });

  async function invokeCommand(commandUuid: string) {
    let timeoutMs = 50;
    while (commandUuid === commandId) {
      const pollOut = await pollCommand(commandUuid, timeoutMs);
      if (!pollOut) {
        timeoutMs *= 2;
        timeoutMs = Math.min(400, timeoutMs);
        continue;
      } else {
        timeoutMs = 50;
      }

      output = {
        uuid: commandUuid,
        status: pollOut.success ?? output?.status ?? null,
        data: [...(output?.data ?? []), ...pollOut.data],
      };

      if (pollOut.end) {
        moveDown = !$cellInfo.lua;
        break;
      }
    }
  }

  $: cellInfo = sheet.cells.get(cellId)!;

  $: if (commandId !== null) invokeCommand(commandId);

  $: if (moveDown) {
    moveDown = false;
    sheet.moveDownFrom({
      id: $cellInfo.id,
      directory: nextDir ?? undefined,
    });
  }

  function submitCommand() {
    submit($cellInfo)?.result.then((result) => {
      switch (result.kind) {
        case "command": {
          const uuid = result.commandId;
          output = { uuid, status: null, data: [] };
          commandId = uuid;
          break;
        }
        case "cd": {
          nextDir = result.nextDir;
          moveDown = true;
          break;
        }
      }
    });
  }

  function onKeyDown(evt: IKeyboardEvent) {
    if (!shouldSubmitCommand(evt, $cellInfo)) return;

    evt.browserEvent.preventDefault();

    submitCommand();
  }

  $: if (editor) {
    editor.onKeyDown(onKeyDown);

    // NOTE: we need to use an Action instead of a command because there's some
    // pretty silly behavior in monaco right now where commands are global to
    // the entire app, wheras actions can be registered per-editor.
    //
    // See: https://github.com/microsoft/monaco-editor/issues/3345
    editor.addAction({
      id: "webb-submit-command",
      label: "Run command",
      keybindings: [KeyMod.CtrlCmd | KeyCode.Enter],
      run: submitCommand,
    });
  }

  $: if ($cellInfo.focus && editor) {
    editor.focus();
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
      switch (data.kind) {
        case "Stderr":
        case "Stdout":
          return [data.value];
        default:
          return [];
      }
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
  <div class="textRow">
    <input type="checkbox" bind:checked={$cellInfo.lua} />

    <div class="textWrapper">
      <Monaco
        bind:value={$cellInfo.contents}
        bind:editor
        language={$cellInfo.lua ? "lua" : "shell"}
      />
    </div>
  </div>

  {#key output?.uuid}
    {#if output !== null}
      <div class="row">
        {#if output.status === null}
          RUNNING
        {:else if output.status}
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

  .textRow {
    display: flex;
    flex-direction: row;
  }

  .textWrapper {
    flex-grow: 1;
  }

  .row {
    display: flex;
    gap: 0.5rem;
  }

  .terminal {
    width: 100%;
  }
</style>

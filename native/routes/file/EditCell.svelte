<script lang="ts" context="module">
  import type { CellInfo, Sheet } from "./cellStore";
  import { suggestPath, runCommand } from "$lib/handlers";

  function matchKey(
    e: IKeyboardEvent,
    key: string,
    combo: { meta?: true; shift?: true; ctrl?: true } = {},
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
          },
        ),
      };
    }

    const result = runCommand({
      kind: cell.language,
      source: cell.contents,
    });

    return {
      cell,
      result: result.then((s) => ({ kind: "command", commandId: s })),
    };
  }

  function shouldSubmitCommand(e: IKeyboardEvent, cell: CellInfo): boolean {
    if (!e.target) return false;

    if (matchKey(e, "Enter", { shift: true })) return false;

    if (
      matchKey(e, "Enter") &&
      cell.contents.split("\n").length <= 1 &&
      cell.language.kind === "Shell"
    ) {
      return true;
    }

    return false;
  }
</script>

<script lang="ts">
  import Monaco, { type Editor } from "$lib/Monaco.svelte";
  import { KeyCode, KeyMod } from "monaco-editor";
  import type { IKeyboardEvent } from "monaco-editor";
  import TermDisplay from "$lib/TermDisplay.svelte";

  export let sheet: Sheet;
  export let cellId: string;

  let commandId: string | null = null;
  let moveDown = false;
  let nextDir: string | null = null;

  let editor: Editor | undefined = undefined;

  $: cellInfo = sheet.cells.get(cellId)!;

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
</script>

<div class="wrapper">
  <div class="textRow">
    <input
      type="checkbox"
      checked={$cellInfo.language.kind === "Lua"}
      on:change={() => {
        switch ($cellInfo.language.kind) {
          case "Shell":
            $cellInfo.language = { kind: "Lua" };
            break;
          case "Lua":
            $cellInfo.language = {
              kind: "Shell",
              working_directory: $cellInfo.directory,
            };
            break;
        }
      }}
    />

    <div class="textWrapper">
      <Monaco
        bind:value={$cellInfo.contents}
        bind:editor
        language={$cellInfo.language.kind.toLowerCase()}
      />
    </div>
  </div>

  <TermDisplay
    {commandId}
    onCommandDone={() => {
      moveDown = $cellInfo.language.kind === "Shell";
    }}
  />
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
</style>

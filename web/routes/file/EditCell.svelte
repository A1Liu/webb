<script lang="ts" context="module">
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

    console.log("input evt");
    const target = e.target as HTMLTextAreaElement;

    target.style.minHeight = "0px";
    target.style.minHeight = target.scrollHeight + "px";
  }

  interface CommandOutput {
    stdout: string;
    stderr: string;
  }
  async function keyHandler(
    e: KeyboardEvent,
    sheet: Sheet,
    cell: CellInfo
  ): Promise<CommandOutput | undefined> {
    if (!e.target) return;
    if (e.isComposing || e.keyCode === 229) return undefined;

    if (matchKey(e, "Enter", { shift: true })) return undefined;

    if (
      matchKey(e, "Enter", { meta: true }) ||
      (matchKey(e, "Enter") && cell.contents.split("\n").length <= 1)
    ) {
      e.preventDefault();
      sheet.moveDownFrom(cell.id);

      await invoke("run_zsh", {
        id: cell.id,
        command: cell.contents,
      });

      return cell;
    }
  }
</script>

<script lang="ts">
  import type { Sheet } from "./cellStore";
  import { Handlers } from "$lib/handlers";

  export let sheet: Sheet;
  export let cellId: string;

  let ref = null;
  let output = null;

  $: cellInfo = sheet.cells.get(cellId)!;

  $: if ($cellInfo.focus && ref !== null) {
    ref.focus();
    $cellInfo.focus = false;
  }
</script>

<div class="wrapper">
  {#if !cellInfo}
    <textarea disabled />
  {:else}
    <textarea
      bind:this={ref}
      bind:value={$cellInfo.contents}
      on:input={inputHandler}
      on:keydown={(e) =>
        void keyHandler(e, sheet, $cellInfo).then(async (cell) => {
          if (!cell) return;

          output = { status: null, data: [] };

          while (true) {
            const pollOut = await invoke("poll_command", {
              id: cell.id,
            });

            console.log(pollOut);

            output = {
              status: output.status ?? pollOut.status,
              data: [...output.data, ...pollOut.data],
            };

            if (output.status !== null && pollOut === null) {
              break;
            }
          }
        })}
    />
  {/if}

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

    {#if output.data.length > 0}
      <pre><code
          >{output.data
            .map((d) => {
              if (d.Stdout) return d.Stdout;
              if (d.Stderr) return d.Stderr;
              return "";
            })
            .join("")}</code
        ></pre>
    {/if}
  {/if}
</div>

<style>
  .wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.25rem;
    background-color: rgb(128, 128, 128);
    width: 32rem;
  }

  .row {
    display: flex;
    gap: 0.5rem;
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

  pre {
    padding: 0.5rem;
    border-radius: 0.25rem;
    white-space: pre-wrap;
  }
</style>

<script lang="ts">
  // This doesn't fully make sense right now as a component, but my hope is
  // that once some other systems are in place it will start to be
  // a little less silly.

  import { Terminal } from "xterm";
  import { FitAddon } from "xterm-addon-fit";
  import { type RunnerOutputExt, pollCommand } from "./handlers";
  import { onDestroy } from "svelte";

  export let commandId: string | null;
  export let onCommandDone: () => unknown = () => {};
  let newlineBuffered = false;

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

  let termRef: any = null;
  let output: {
    uuid: string;
    status: boolean | null;
    data: RunnerOutputExt[];
  } | null = null;

  const listenerDisposerLF = term.onLineFeed(() => {
    if (term.rows < 30) {
      term.resize(term.cols, term.rows + 1);
    }
  });

  async function consumeCommandOutput(commandUuid: string) {
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
        status: pollOut.success ?? null,
        data: [...(output?.data ?? []), ...pollOut.data],
      };

      if (pollOut.end) {
        onCommandDone();
        // moveDown = $cellInfo.language.kind === "Shell";
        break;
      }
    }
  }

  $: if (commandId !== null) consumeCommandOutput(commandId);

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

<style>
  .row {
    display: flex;
    gap: 0.5rem;
  }

  .terminal {
    width: 100%;
  }
</style>

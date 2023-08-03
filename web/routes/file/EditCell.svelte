<script lang="ts" context="module">
  const inputHandler = (e: Event) => {
    if (!e.target) return;

    const target = e.target as HTMLTextAreaElement;

    target.style.minHeight = "0px";
    target.style.minHeight = target.scrollHeight + "px";
  };

  const keyHandler = (e: KeyboardEvent, sheet: Sheet) => {
    if (!e.target) return;
    if (e.isComposing || e.keyCode === 229) return;

    if (e.key === "Enter" && e.metaKey) sheet.createCell();

    console.log("aliu", e);
  };
</script>

<script lang="ts">
  import type { Sheet } from "./cellStore";

  export let sheet: Sheet;
  export let cellId: string;

  $: cellInfo = sheet.cells.get(cellId)!;
</script>

{#if !cellInfo}
  <textarea disabled />
{:else}
  <textarea
    bind:value={$cellInfo.contents}
    on:input={inputHandler}
    on:keydown={(e) => keyHandler(e, sheet)}
  />
{/if}

<style>
  textarea {
    font-family: var(--font-mono);
    width: 32rem;
    border: none;
    height: 1.15rem;
    padding: 0px;
    resize: none;
    overflow-y: hidden;
  }
</style>

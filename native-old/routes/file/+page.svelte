<script lang="ts">
  import { Sheet } from "./cellStore";
  import { page } from "$app/stores";
  import EditCell from "./EditCell.svelte";

  let sheet = new Sheet();
  $: layout = sheet.cellLayout;
  $: sheet.createCell();

  $: path = $page.url.searchParams.get("path");
</script>

<a href="/">go back</a>
<button on:click={() => (sheet = new Sheet())}>reset</button>

<div>
  PATH = {path}
</div>

<div class="blarg">
  {#each $layout as cellId}
    <EditCell {sheet} {cellId} />
  {/each}

  <button on:click={() => sheet.createCell()}>+ Add</button>
</div>

<style>
  .blarg {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  button {
    width: fit-content;
  }
</style>

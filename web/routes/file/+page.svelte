<script lang="ts">
  import { Sheet } from "./cellStore";
  import { page } from "$app/stores";
  import EditCell from "./EditCell.svelte";
  import Monaco from "$lib/Monaco.svelte";

  const sheet = new Sheet();
  const layout = sheet.cellLayout;
  sheet.createCell();

  $: path = $page.url.searchParams.get("path");
  let value = "";
</script>

<a href="/">go back</a>

<div>
  PATH = {path}

  <Monaco bind:value />
</div>

<div class="blarg">
  {#each $layout as cellId}
    <EditCell {sheet} {cellId} />
  {/each}
</div>

<style>
  .blarg {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
</style>

<script lang="ts">
  import { page } from "$app/stores";
  import EditCell from "./EditCell.svelte";

  $: path = $page.url.searchParams.get("path");
</script>

<a href="/"> go back </a>

<div>
  path = {path}
</div>

<EditCell />

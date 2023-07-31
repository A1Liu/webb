<script lang="ts">
  import { page } from "$app/stores";

  function resize(element, handler: (element, detail) => unknown) {
    const ro = new ResizeObserver((entries, observer) => {
      for (let entry of entries) {
        handler(element, entry);
      }
    });
    ro.observe(element);
    return {
      destroy() {
        ro.disconnect();
      },
    };
  }

  $: path = $page.url.searchParams.get("path");
</script>

<a href="/"> go back </a>

<div>
  path = {path}
</div>

<textarea
  on:input={(e) => {
    e.target.style.height = 0;
    e.target.style.height = e.target.scrollHeight + "px";
  }}
/>

<style>
  textarea {
    font-family: var(--font-mono);
    width: 32rem;
    height: 1.375rem;
    resize: none;
    overflow-y: hidden;
  }
</style>

<script lang="ts" context="module">
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
</script>

<script lang="ts">
  let value;
</script>

<textarea
  bind:value={value}
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

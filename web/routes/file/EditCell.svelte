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
  bind:value
  on:input={(e) => {
    e.target.style.minHeight = 0;
    e.target.style.minHeight = e.target.scrollHeight + "px";
  }}
/>

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

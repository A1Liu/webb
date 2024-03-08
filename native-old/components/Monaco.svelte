<script lang="ts" context="module">
  import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

  self.MonacoEnvironment = {
    getWorker: function (_moduleId: any, label: string) {
      switch (label) {
        default:
          return new editorWorker();
      }
    },
  };

  export type Editor = Monaco.editor.IStandaloneCodeEditor;
</script>

<script lang="ts">
  import type Monaco from "monaco-editor";
  import * as monaco from "monaco-editor";
  import { onMount } from "svelte";

  export let editor: Editor | undefined = undefined;
  export let value: string;
  export let language: string = "shell";
  export let disabled: boolean = false;

  let container: HTMLDivElement;

  // This is a kinda silly way to synchronize the `value` field to the editor,
  // but it gets the job done; it shouldn't matter much right now, because
  // the cells are very small.
  $: if (editor && editor.getValue() != value) {
    const position = editor.getPosition();
    editor.setValue(value);
    if (position) editor.setPosition(position);
  }

  $: if (editor) {
    editor.updateOptions({ readOnly: disabled });
  }

  $: if (editor) {
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, language);
    }
  }

  onMount(() => {
    const ed = monaco.editor.create(container, {
      value: "",
      scrollBeyondLastLine: false,
      wordWrap: "on",
      wrappingStrategy: "advanced",
      minimap: { enabled: false },
      lineDecorationsWidth: 0,
      overviewRulerLanes: 0,
      lineNumbers: "off",
      folding: false,
    });
    editor = ed;

    ed.getModel()!.onDidChangeContent(() => {
      if (!editor) return;
      value = editor.getValue();
    });

    function updateHeight() {
      const width = container.getBoundingClientRect().width;
      const contentHeight = Math.min(300, ed.getContentHeight());
      container.style.width = `${width}px`;
      container.style.height = `${contentHeight}px`;
      try {
        ed.layout({ height: contentHeight, width });
      } catch {}
    }

    ed.onDidContentSizeChange(updateHeight);
    updateHeight();

    return () => editor?.dispose();
  });
</script>

<div bind:this={container} class="container" />

<style>
  .container {
    width: 100%;
    min-width: 100%;
  }
</style>

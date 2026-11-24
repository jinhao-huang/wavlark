<script>
  import { invalidateAll } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import Button from '#lib/components/ui/button/button.svelte';
  import ResourceList from '#lib/components/ResourceList.svelte';
  import { formatSize } from '#lib/catalog.js';

  let { data } = $props();
  const selected = new SvelteMap();
  let bytes = $derived(Array.from(selected.values()).reduce((sum, file) => sum + file.size_bytes, 0));
  let transfer = $state(null);
  onDestroy(() => transfer?.abort());
  let notice = $state('');

  const downloadUrl = id => '/api/downloads/' + id;

  function select(file, checked) {
    if (checked) selected.set(file.id, file);
    else selected.delete(file.id);
    notice = '';
  }

  async function download() {
    if (!selected.size || transfer) return;
    const controller = new AbortController();
    transfer = controller;
    notice = '';
    const ids = [...selected.keys()];
    try {
      const response = await fetch('/api/downloads/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids),
        signal: controller.signal
      });
      if (!response.ok) throw new Error();
      const missing = await response.json();
      if (missing.length) {
        const paths = missing.map(({ id }) => selected.get(id).path);
        for (const { id } of missing) selected.delete(id);
        notice = `No longer available: ${paths.join(', ')}. Review your selection.`;
        await invalidateAll();
        return;
      }

      const link = document.createElement('a');
      link.download = '';
      for (const [i, id] of ids.entries()) {
        // Browsers can drop bursts of more than ten automatic downloads.
        if (i && i % 10 === 0) await new Promise(resolve => setTimeout(resolve, 1100));
        if (controller.signal.aborted) return;
        link.href = downloadUrl(id);
        link.click();
      }
      notice = ids.length === 1 ? 'Check your browser’s downloads for progress.'
        : 'Check your browser’s downloads. If any files are missing, use the individual links.';
    } catch {
      if (!controller.signal.aborted) notice ||= 'Could not check the selection. Please retry.';
    } finally {
      transfer = null;
    }
  }
</script>

<svelte:head><title>Public files · Wavlark</title></svelte:head>
<h1>Public files</h1>
{#if selected.size}
  <div class="mt-5 flex flex-wrap items-center gap-3">
    <span role="status">{selected.size} selected · {formatSize(bytes)}</span>
    <Button disabled={!!transfer} onclick={download}>{transfer ? 'Requesting downloads…' : `Download selected files (${selected.size})`}</Button>
    <Button variant="outline" disabled={!!transfer} onclick={() => { selected.clear(); notice = ''; }}>Clear selection</Button>
  </div>
  <details class="mt-3">
    <summary class="w-fit cursor-pointer text-sm font-semibold text-primary">Download individually</summary>
    <ul class="mt-2 space-y-1">
      {#each selected.values() as file (file.id)}
        <li><a class="wrap-anywhere text-primary underline" href={downloadUrl(file.id)} target="_blank" rel="noopener">{file.path}</a></li>
      {/each}
    </ul>
  </details>
{/if}
{#if notice}<p role="status" class="mt-3 wrap-anywhere">{notice}</p>{/if}
<ResourceList {data}>
  {#snippet selection(file)}
    {#if file}
      <input type="checkbox" aria-label={`Select ${file.path}`} checked={selected.has(file.id)}
        disabled={!!transfer} onchange={event => select(file, event.currentTarget.checked)} />
    {:else}
      <input type="checkbox" aria-label="Select all files on this page" disabled={!!transfer}
        checked={data.resources.every(file => selected.has(file.id))}
        indeterminate={data.resources.some(file => selected.has(file.id)) && !data.resources.every(file => selected.has(file.id))}
        onchange={event => data.resources.forEach(file => select(file, event.currentTarget.checked))} />
    {/if}
  {/snippet}
</ResourceList>

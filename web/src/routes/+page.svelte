<script>
  import { invalidateAll } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import { prepareDownload } from '#lib/download.js';
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
    try {
      const result = await prepareDownload([...selected.values()], controller.signal, message => notice = message);
      if (result.missing) {
        for (const file of result.missing) selected.delete(file.id);
        notice = `No longer available: ${result.missing.map(file => file.path).join(', ')}. Review your selection.`;
        await invalidateAll();
      } else if (result.blob) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(result.blob);
        link.download = 'wavlark.zip';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
        notice = '';
      } else {
        window.location.assign(result.url);
      }
    } catch (error) {
      if (!controller.signal.aborted) notice = error.message;
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
    <Button disabled={!!transfer} onclick={download}>{selected.size === 1 ? 'Download file' : 'Download ZIP'}</Button>
    <Button variant="outline" disabled={!!transfer} onclick={() => { selected.clear(); notice = ''; }}>Clear selection</Button>
  </div>
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

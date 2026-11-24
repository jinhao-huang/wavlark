<script>
  import Button from '#lib/components/ui/button/button.svelte';
  import { encodePath, formatDate, formatSize } from '#lib/catalog.js';
  let { data } = $props();
  let file = $derived(data.file);
</script>

<svelte:head><title>{file.path} · Wavlark</title></svelte:head>

<a class="text-link" href="/">All files</a>
<h1 class="mt-5 wrap-anywhere">{file.path}</h1>
<p class="mt-4 muted">{formatSize(file.size_bytes)} · Published {formatDate(file.published_at)}</p>
{#if file.description}
  <p class="mt-6 max-w-prose whitespace-pre-line wrap-anywhere">{file.description}</p>
{/if}
<Button class="mt-8" href={'/download/' + encodePath(file.path)} data-sveltekit-reload>Download file</Button>
{#if file.public_mbps}
  <p class="mt-2 text-sm muted">Up to {file.public_mbps} MB/s per download.</p>
{/if}

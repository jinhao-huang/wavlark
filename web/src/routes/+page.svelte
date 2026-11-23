<script>
  import Button from '#lib/components/ui/button/button.svelte';
  import { formatDate, formatSize } from '#lib/catalog.js';
  let { data } = $props();
</script>

<svelte:head><title>Public files · Wavlark</title></svelte:head>

<h1>Public files</h1>
{#if data.resources.length}
  <table class="mt-10 w-full text-left">
    <thead class="border-b border-line text-sm muted">
      <tr><th scope="col">File name</th><th scope="col">Size</th><th scope="col">Published</th></tr>
    </thead>
    <tbody>
      {#each data.resources as file (file.id)}
        <tr class="border-b border-line">
          <td><a class="font-semibold text-primary hover:underline" href={'/resources/' + encodeURIComponent(file.id)}>{file.name}</a></td>
          <td>{formatSize(file.size_bytes)}</td>
          <td>{formatDate(file.published_at)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else}
  <p class="mt-10 border-y border-line py-8 muted">
    {data.page === 1 ? 'No public files yet.' : 'No files on this page.'}
  </p>
{/if}

{#if data.page > 1 || data.has_next}
  <nav aria-label="Catalog pages" class="mt-6 flex flex-wrap items-center gap-4">
    {#if data.page > 1}
      <Button variant="outline" href={data.page === 2 ? '/' : '/?page=' + (data.page - 1)}>Previous</Button>
    {/if}
    <span class="text-sm muted" aria-current="page">Page {data.page}</span>
    {#if data.has_next}
      <Button variant="outline" href={'/?page=' + (data.page + 1)}>Next</Button>
    {/if}
  </nav>
{/if}

<style>
  th { padding-bottom: .65rem; font-weight: 500; }
  td { padding-block: 1.05rem; }
  td:first-child { width: 60%; overflow-wrap: anywhere; }
  :is(th, td):not(:last-child) { padding-right: 1rem; }
  td:not(:first-child) { font-size: .875rem; font-variant-numeric: tabular-nums; }
  @media (max-width: 36rem) {
    td:first-child { width: 45%; }
    :is(th, td):not(:last-child) { padding-right: .6rem; }
  }
</style>

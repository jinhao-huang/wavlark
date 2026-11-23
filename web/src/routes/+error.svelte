<script>
  import { page } from '$app/state';
</script>

<svelte:head><title>{page.status} · Wavlark</title></svelte:head>
<h1>{page.error?.message ?? 'Something went wrong.'}</h1>
<a class="text-link mt-6 inline-block" href="/" data-sveltekit-reload>Back to public files</a>

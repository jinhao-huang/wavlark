<script>
  import ResourceList from '#lib/components/ResourceList.svelte';
  let { data } = $props();
</script>

<svelte:head><title>Public files · Wavlark</title></svelte:head>
<h1>Public files</h1>
<ResourceList {data} />

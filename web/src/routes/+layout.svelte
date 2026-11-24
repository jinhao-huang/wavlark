<script>
  import './app.css';
  let { children } = $props();
</script>

<header class="masthead flex items-center justify-between">
  <a href="/" class="brand">Wavlark</a>
  <a class="text-link" href="/manage" data-sveltekit-reload>Manage files</a>
</header>
<main>{@render children()}</main>

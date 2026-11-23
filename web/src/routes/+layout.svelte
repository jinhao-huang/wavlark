<script>
  import './app.css';
  let { children } = $props();
</script>

<header class="masthead">
  <a href="/" class="brand">Wavlark</a>
</header>
<main>{@render children()}</main>

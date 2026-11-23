<svelte:head>
  <title>Wavlark · Public file library</title>
</svelte:head>

<main>
  <h1>Wavlark</h1>
  <p>Public file library</p>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f8f8f5;
    color: #202520;
    font-family: system-ui, sans-serif;
  }

  main {
    max-width: 64rem;
    margin: auto;
    padding: clamp(3rem, 10vw, 8rem) 1.5rem;
  }

  h1 {
    margin: 0;
    font-size: clamp(3rem, 9vw, 6rem);
    line-height: 1;
    letter-spacing: -0.06em;
  }

  p {
    margin-top: 1rem;
    color: #535c52;
  }
</style>

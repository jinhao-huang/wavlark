<script>
  import Button from '#lib/components/ui/button/button.svelte';
  import { requestUpload, sendFile } from '#lib/upload.js';

  let { data } = $props();
  let files = $state();
  let description = $state('');
  let upload = $state(null);
  let phase = $state('ready');
  let sent = $state(0);
  let message = $state('');
  let busy = $derived(phase === 'starting' || phase === 'uploading');

  function reset() {
    upload = null;
    phase = 'ready';
    message = '';
    sent = 0;
  }

  async function submit(event) {
    event.preventDefault();
    const file = files?.[0];
    if (!file || busy) return;
    message = '';
    try {
      phase = 'starting';
      upload ??= await requestUpload(file, description);
      sent = 0;
      phase = 'uploading';
      await sendFile(upload, file, (bytes) => sent = bytes);
      phase = 'uploaded';
    } catch (error) {
      if (error.cause === 403) upload = null;
      message = error.message;
      phase = 'ready';
    }
  }
</script>

<svelte:head><title>Publisher workspace · Wavlark</title></svelte:head>
<h1>Publisher workspace</h1>
<p class="mt-4 muted">Signed in as <strong>{data.email}</strong></p>

<form class="mt-8 grid max-w-xl gap-5" onsubmit={submit}>
  <label class="grid gap-2 font-semibold">
    File
    <input type="file" required bind:files onchange={reset} disabled={busy}
      class="rounded-md border border-line bg-white p-3 text-sm font-normal file:mr-3 file:font-semibold" />
  </label>
  <label class="grid gap-2 font-semibold">
    Description (optional)
    <textarea rows="3" bind:value={description} disabled={busy || phase === 'uploaded'} oninput={reset}
      class="rounded-md border border-line bg-white p-3 font-normal"></textarea>
  </label>
  <div aria-live="polite">
    {#if phase === 'starting'}
      Preparing upload…
    {:else if phase === 'uploading'}
      <progress aria-label="File upload" value={sent} max={files[0].size || 1}></progress>
      {Math.floor(sent / (files[0].size || 1) * 100)}%
    {:else if phase === 'uploaded'}
      Uploaded. Awaiting publication.
    {:else if message}
      {message}
    {/if}
  </div>
  {#if phase !== 'uploaded'}
    <Button type="submit" class="justify-self-start" disabled={!files?.length || busy}>
      {message ? 'Retry upload' : 'Upload file'}
    </Button>
  {/if}
</form>

<script>
  import { goto } from '$app/navigation';
  import Button from '#lib/components/ui/button/button.svelte';
  import { requestUpload, sendFile } from '#lib/upload.js';

  let { data } = $props();
  let files = $state();
  let description = $state('');
  let upload = $state(null);
  let phase = $state('ready');
  let sent = $state(0);
  let message = $state('');
  let busy = $derived(phase === 'starting' || phase === 'uploading' || phase === 'publishing');

  function reset() {
    upload = null;
    phase = 'ready';
    message = '';
    sent = 0;
  }

  async function publish() {
    phase = 'publishing';
    message = '';
    try {
      const response = await fetch(`/api/manage/resources/${upload.id}/publication`, { method: 'PUT' });
      if (response.status === 409) {
        reset();
        message = 'The stored file could not be verified. Upload it again.';
        return;
      }
      if (response.status !== 204) throw new Error();
      await goto(`/resources/${upload.id}`, { refreshAll: true });
    } catch {
      phase = 'uploaded';
      message = 'Publication could not be confirmed. Try confirming again.';
    }
  }

  async function submit(event) {
    event.preventDefault();
    const file = files?.[0];
    if (!file || busy) return;
    if (phase === 'uploaded') return publish();
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
    {:else if phase === 'publishing'}
      Confirming publication…
    {:else if message}
      {message}
    {:else if phase === 'uploaded'}
      Uploaded. Confirm to make this file public.
    {/if}
  </div>
  <Button type="submit" class="justify-self-start" disabled={!files?.length || busy}>
    {#if phase === 'uploaded' || phase === 'publishing'}Confirm publication
    {:else if message}Retry upload
    {:else}Upload file{/if}
  </Button>
</form>

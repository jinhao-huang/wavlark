<script>
  import { goto } from '$app/navigation';
  import Button from '#lib/components/ui/button/button.svelte';
  import { encodePath } from '#lib/catalog.js';
  import { requestUpload, sendFile } from '#lib/upload.js';

  let files = $state();
  let directory = $state('');
  let description = $state('');
  let requestId;
  let upload = $state(null);
  let phase = $state('ready');
  let sent = $state(0);
  let message = $state('');
  let busy = $derived(phase === 'starting' || phase === 'uploading' || phase === 'publishing');

  function reset() {
    requestId = undefined;
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
      if ([404, 409, 410].includes(response.status)) {
        if (response.status !== 409) upload = null;
        phase = 'ready';
        message = await response.text();
        return;
      }
      if (response.status !== 204) throw new Error();
      await goto(`/resources/${encodePath(upload.path)}`, { refreshAll: true });
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
      requestId ??= crypto.randomUUID();
      upload = await requestUpload(file, directory, description, requestId, upload?.id);
      sent = 0;
      phase = 'uploading';
      await sendFile(upload, file, (bytes) => sent = bytes);
      phase = 'uploaded';
    } catch (error) {
      if ([404, 410].includes(error.cause)) upload = null;
      message = error.message;
      phase = 'ready';
    }
  }
</script>

<form class="mt-8 grid max-w-xl gap-5" onsubmit={submit}>
  <label class="grid gap-2 font-semibold">
    File
    <input type="file" required bind:files onchange={reset} disabled={busy}
      class="rounded-md border border-line bg-white p-3 text-sm font-normal file:mr-3 file:font-semibold" />
  </label>
  <label class="grid gap-2 font-semibold">
    Directory (optional)
    <input type="text" placeholder="e.g. Maps/Europe" bind:value={directory} oninput={reset} disabled={busy}
      class="rounded-md border border-line bg-white p-3 text-sm font-normal" />
  </label>
  <label class="grid gap-2 font-semibold">
    Description (optional)
    <textarea rows="3" bind:value={description} oninput={reset} disabled={busy || !!upload}
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
      Uploaded to {upload.path}. Confirm publication within 24 hours of starting the draft.
    {/if}
  </div>
  <Button type="submit" class="justify-self-start" disabled={!files?.length || busy}>
    {#if phase === 'uploaded' || phase === 'publishing'}Confirm publication
    {:else if message}Retry upload
    {:else}Upload file{/if}
  </Button>
</form>

<script>
  import { invalidateAll } from '$app/navigation';
  import Button from '#lib/components/ui/button/button.svelte';
  import { requestUpload, sendFile } from '#lib/upload.js';

  let { draft, partSize, maxSize, onrefresh, onuploaded = onrefresh, busy = $bindable(false) } = $props();
  let files = $state();
  let directory = $state('');
  let description = $state('');
  let requestId;
  let pendingId = $state();
  let digest;
  let resumable = $derived(draft ? draft.uploaded_bytes != null : files?.[0]?.size > partSize);
  let sent = $state(null);
  let message = $state('');

  function reset() {
    requestId = undefined;
    pendingId = undefined;
    message = '';
  }

  async function submit(event) {
    event.preventDefault();
    const file = files?.[0];
    if (!file || busy) return;
    if (draft && (file.name !== draft.path.split('/').pop() || file.size !== draft.size_bytes)) {
      message = 'Choose the original file with the same name and size.';
      return;
    }
    if (!draft && file.size > maxSize) {
      message = `Choose a file of ${maxSize / (1024 * 1024)} MiB or smaller.`;
      return;
    }
    busy = true;
    message = '';
    sent = null;
    const draftId = draft?.id ?? pendingId;
    let ticket;
    let written;
    try {
      if (!draftId) requestId ??= crypto.randomUUID();
      if (resumable && !digest) {
        const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
      }
      ticket = await requestUpload(file, directory, description, requestId, draftId, digest);
      pendingId = ticket.id;
      sent = 0;
      written = await sendFile(ticket, file, (bytes) => sent = bytes);
    } catch (error) {
      message = error.message;
      try {
        if (draftId && [404, 409, 410].includes(error.cause) && !ticket) {
          reset();
          await onrefresh(error.message);
        } else if (ticket) {
          await invalidateAll();
        }
      } catch {
        message = `${error.message} Reload Manage files to refresh the draft list.`;
      }
      busy = false;
      return;
    }
    if (!draft) {
      files = new DataTransfer().files;
      directory = '';
      description = '';
      reset();
    }
    try {
      await onuploaded(written
        ? `Uploaded “${ticket.path}”. Confirm publication when ready.`
        : `“${ticket.path}” already has a file. Confirm the existing file, or discard the draft to upload a replacement.`);
    } catch {
      message = 'Reload Manage files to confirm publication.';
    } finally {
      busy = false;
    }
  }
</script>

<form class="mt-4 grid max-w-xl gap-4" onsubmit={submit}>
  <label class="grid gap-2 font-semibold">
    {draft ? 'Original file' : 'File'}
    <input type="file" required bind:files onchange={() => { digest = undefined; reset(); }} disabled={busy}
      class="rounded-md border border-line bg-white p-3 text-sm font-normal file:mr-3 file:font-semibold" />
  </label>
  {#if !draft}
    <label class="grid gap-2 font-semibold">
      Directory (optional)
      <input type="text" placeholder="e.g. Maps/Europe" bind:value={directory} oninput={reset} disabled={busy}
        class="rounded-md border border-line bg-white p-3 font-normal" />
    </label>
    <label class="grid gap-2 font-semibold">
      Description (optional)
      <textarea rows="3" bind:value={description} oninput={reset} disabled={busy}
        class="rounded-md border border-line bg-white p-3 font-normal"></textarea>
    </label>
  {/if}
  <div aria-live="polite">
    {#if busy && sent === null}
      Preparing upload…
    {:else if busy && files?.length}
      <progress aria-label="File upload" value={sent} max={files[0].size || 1}></progress>
      {Math.floor(sent / (files[0].size || 1) * 100)}%
    {:else}
      {message}
    {/if}
  </div>
  <Button type="submit" class="justify-self-start" disabled={!files?.length || busy}>
    {resumable && (draft || pendingId) ? 'Continue upload' : draft || pendingId ? 'Upload again' : 'Upload file'}
  </Button>
</form>

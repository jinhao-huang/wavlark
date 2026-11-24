<script>
  import Button from '#lib/components/ui/button/button.svelte';
  import { requestUpload, sendFile } from '#lib/upload.js';

  let { draft, partSize, maxSize, onrefresh, busy = $bindable(false) } = $props();
  let items = $state([]);
  let directory = $state('');
  let description = $state('');
  let notice = $state('');

  function choose(input) {
    items = Array.from(input.files, file => ({
      file, requestId: crypto.randomUUID(), id: draft?.id, digest: undefined,
      status: 'Waiting', sent: 0, error: ''
    }));
    notice = '';
  }

  async function upload(item) {
    const { file } = item;
    item.status = 'Preparing';
    item.error = '';
    try {
      if (draft && (file.name !== draft.path.split('/').pop() || file.size !== draft.size_bytes)) {
        throw new Error('Choose the original file with the same name and size.');
      }
      if (!draft && file.size > maxSize) throw new Error(`Choose a file of ${maxSize / 1024 ** 2} MiB or smaller.`);
      if ((draft ? draft.uploaded_bytes != null : file.size > partSize) && !item.digest) {
        const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        item.digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      }
      const ticket = await requestUpload(file, directory, description, item.requestId, item.id, item.digest);
      item.id = ticket.id;
      item.path = ticket.path;
      item.sent = ticket.offset ?? 0;
      item.status = 'Uploading';
      const written = await sendFile(ticket, file, bytes => item.sent = bytes);
      item.status = written ? 'Uploaded' : 'Already uploaded';
      if (written) return item.id;
      item.error = 'Review the existing draft before publication, or discard it to upload a replacement.';
    } catch (error) {
      if (!draft && [404, 410].includes(error.cause)) {
        item.id = undefined;
        item.path = undefined;
      }
      item.status = 'Failed';
      item.error = error.message;
    }
  }

  async function run(pending) {
    if (busy || !pending.length) return;
    busy = true;
    notice = '';
    const uploaded = [];
    const work = pending.values();
    async function next() {
      for (const item of work) {
        const id = await upload(item);
        if (id) uploaded.push(id);
      }
    }
    try {
      await Promise.all([next(), next()]);
      await onrefresh(uploaded);
    } catch {
      notice = 'Reload Manage files to refresh the draft list.';
    } finally {
      busy = false;
    }
  }
</script>

<form class="mt-4 grid max-w-xl gap-4" onsubmit={event => {
  event.preventDefault();
  run(items.filter(item => item.status === 'Waiting'));
}}>
  <label class="grid gap-2 font-semibold">
    {draft ? 'Original file' : 'Files'}
    <input type="file" multiple={!draft} onclick={event => event.currentTarget.value = ''} onchange={event => choose(event.currentTarget)} disabled={busy}
      class="rounded-md border border-line bg-white p-3 text-sm font-normal file:mr-3 file:font-semibold" />
  </label>
  {#if !draft}
    <label class="grid gap-2 font-semibold">
      Directory (optional)
      <input type="text" placeholder="e.g. Maps/Europe" bind:value={directory} disabled={busy}
        class="rounded-md border border-line bg-white p-3 font-normal" />
    </label>
    <label class="grid gap-2 font-semibold">
      Description for all files (optional)
      <textarea rows="2" bind:value={description} disabled={busy}
        class="rounded-md border border-line bg-white p-3 font-normal"></textarea>
    </label>
  {/if}
  {#if items.length}
    <ul class="divide-y divide-line">
      {#each items as item (item.requestId)}
        <li class="grid gap-1 py-2 text-sm">
          <strong class="wrap-anywhere">{item.path ?? item.file.name}</strong>
          <span role="status">{item.status}{item.error ? ` · ${item.error}` : ''}</span>
          {#if item.status === 'Uploading'}
            <progress aria-label={`Uploading ${item.file.name}`} value={item.sent} max={item.file.size || 1}></progress>
          {:else if item.status === 'Failed'}
            {#if !draft && item.id}
              <span class="muted">Retry keeps this draft’s original directory and description.</span>
            {/if}
            <Button variant="outline" class="justify-self-start" disabled={busy} onclick={() => run([item])}>Retry</Button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if !items.length || items.some(item => item.status === 'Waiting')}
    <Button type="submit" class="justify-self-start" disabled={!items.length || busy}>
      {draft ? (draft.uploaded_bytes == null ? 'Upload again' : 'Continue upload') : 'Upload files'}
    </Button>
  {/if}
  {#if notice}<p role="status">{notice}</p>{/if}
</form>

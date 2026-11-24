<script>
  import { goto } from '$app/navigation';
  import Button from '#lib/components/ui/button/button.svelte';
  import { encodePath, formatSize } from '#lib/catalog.js';
  import UploadForm from './UploadForm.svelte';

  let { draft, onrefresh } = $props();
  let busy = $state(false);
  let uploading = $state(false);
  let retry = $state(false);
  let message = $state('');
  let remaining = $derived(draft.uploaded_bytes == null ? null : draft.size_bytes - draft.uploaded_bytes);

  async function act(discard) {
    if (busy || (discard && !window.confirm(`Discard the draft “${draft.path}” and release its path?`))) return;
    busy = true;
    message = '';
    try {
      const action = discard ? 'upload' : 'publication';
      const response = await fetch(`/api/manage/resources/${draft.id}/${action}`, { method: discard ? 'DELETE' : 'PUT' });
      if (response.status === 404 || response.status === 410) {
        await onrefresh(await response.text());
        return;
      }
      if (response.status === 409 || response.status === 422) {
        message = await response.text();
        retry = response.status === 409;
        if (retry) await onrefresh('');
        return;
      }
      if (response.status !== 204) throw new Error();
      if (discard) await onrefresh(`Discarded “${draft.path}”.`);
      else await goto('/resources/' + encodePath(draft.path), { refreshAll: true });
    } catch {
      message = 'Could not confirm the result. Reload Manage files and try again.';
    } finally {
      busy = false;
    }
  }
</script>

<li class="grid gap-2 border-b border-line py-4">
  <strong class="wrap-anywhere">{draft.path}</strong>
  <span class="text-sm muted">{formatSize(draft.size_bytes)} · Expires {new Date(draft.expires_at * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC</span>
  {#if remaining != null}
    <span class="text-sm muted">{remaining ? `${formatSize(remaining)} remaining` : 'Ready to publish'}</span>
  {/if}
  {#if draft.description}<p class="wrap-anywhere">{draft.description}</p>{/if}
  <fieldset disabled={uploading} class="flex flex-wrap gap-2">
    <Button disabled={busy || remaining > 0} onclick={() => act(false)}>Confirm publication</Button>
    {#if remaining !== 0}
      <Button variant="outline" disabled={busy} aria-expanded={retry} onclick={() => retry = !retry}>
        {draft.uploaded_bytes == null ? 'Re-upload file' : 'Resume upload'}
      </Button>
    {/if}
    <Button variant="outline" disabled={busy} onclick={() => act(true)}>Discard draft</Button>
  </fieldset>
  {#if retry}
    <fieldset disabled={busy}>
      <UploadForm {draft} {onrefresh} bind:busy={uploading} onuploaded={async (notice) => {
        retry = false;
        message = notice;
        await onrefresh('');
      }} />
    </fieldset>
  {/if}
  <p role="status" class="text-sm muted">{message}</p>
</li>

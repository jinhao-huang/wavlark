<script>
  import Button from '#lib/components/ui/button/button.svelte';
  import { formatSize } from '#lib/catalog.js';
  import UploadForm from './UploadForm.svelte';

  let { draft, checked, onselect, onuploaded, onrefresh, disabled, uploading = $bindable(false) } = $props();
  let busy = $state(false);
  let retry = $state(false);
  let message = $state('');
  let remaining = $derived(draft.uploaded_bytes == null ? null : draft.size_bytes - draft.uploaded_bytes);

  async function discard() {
    if (!window.confirm(`Discard the draft “${draft.path}” and release its path?`)) return;
    onselect(false);
    busy = true;
    try {
      const response = await fetch(`/api/manage/resources/${draft.id}/upload`, { method: 'DELETE' });
      if (![204, 404, 410].includes(response.status)) throw new Error();
      await onrefresh(response.ok ? `Discarded “${draft.path}”.` : await response.text());
    } catch {
      message = 'Could not confirm the result. Reload Manage files and try again.';
    } finally {
      busy = false;
    }
  }
</script>

<li class="grid gap-2 border-b border-line py-4">
  <label class="flex items-baseline gap-3 font-semibold wrap-anywhere">
    <input type="checkbox" aria-label={`Select ${draft.path} for publication`} {checked}
      disabled={disabled || busy || uploading || remaining > 0} onchange={event => onselect(event.currentTarget.checked)} />
    {draft.path}
  </label>
  <span class="text-sm muted">{formatSize(draft.size_bytes)} · Expires {new Date(draft.expires_at * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC</span>
  {#if remaining != null}
    <span class="text-sm muted">{remaining ? `${formatSize(remaining)} remaining` : 'Ready to publish'}</span>
  {/if}
  {#if draft.description}<p class="wrap-anywhere">{draft.description}</p>{/if}
  <fieldset disabled={disabled || busy || uploading} class="flex flex-wrap gap-2">
    {#if remaining !== 0}
      <Button variant="outline" aria-expanded={retry} onclick={() => { retry = !retry; if (retry) onselect(false); }}>
        {draft.uploaded_bytes == null ? 'Re-upload file' : 'Resume upload'}
      </Button>
    {/if}
    <Button variant="outline" onclick={discard}>Discard draft</Button>
  </fieldset>
  {#if retry}
    <fieldset disabled={disabled || busy}>
      <UploadForm {draft} bind:busy={uploading} onrefresh={async ids => {
        if (ids.length) retry = false;
        await onuploaded(ids);
      }} />
    </fieldset>
  {/if}
  {#if message}<p role="status" class="text-sm muted">{message}</p>{/if}
</li>

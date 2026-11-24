<script>
  import { goto, invalidateAll } from '$app/navigation';
  import { SvelteSet } from 'svelte/reactivity';
  import Button from '#lib/components/ui/button/button.svelte';
  import ResourceList from '#lib/components/ResourceList.svelte';
  import DownloadSettings from './DownloadSettings.svelte';
  import Draft from './Draft.svelte';
  import UploadForm from './UploadForm.svelte';

  let { data } = $props();
  let deletingId = $state(null);
  let notice = $state('');
  let draftNotice = $state('');

  let uploading = $state(false);
  let publishing = $state(false);
  const selected = new SvelteSet();
  let errors = $state([]);
  let publishable = $derived(data.drafts.filter(draft =>
    selected.has(draft.id) && (draft.uploaded_bytes == null || draft.uploaded_bytes === draft.size_bytes)));

  function select(id, checked) {
    if (checked) selected.add(id);
    else selected.delete(id);
  }

  async function uploaded(ids) {
    for (const id of ids) selected.add(id);
    errors = errors.filter(error => !ids.includes(error.id));
    await refreshDrafts(ids.length ? 'Uploaded files are selected below. Confirm publication when ready.' : '');
  }

  async function publish() {
    const drafts = publishable;
    if (publishing || !drafts.length) return;
    publishing = true;
    errors = [];
    let count = 0;
    for (const draft of drafts) {
      let message;
      try {
        const response = await fetch(`/api/manage/resources/${draft.id}/publication`, { method: 'PUT' });
        if (response.status === 204) {
          selected.delete(draft.id);
          count++;
          continue;
        }
        message = [404, 409, 410, 422].includes(response.status)
          ? await response.text() : 'Could not confirm publication. Check your sign-in and the published files list.';
      } catch {
        message = 'Could not confirm publication. Check the published files list before retrying.';
      }
      errors.push({ id: draft.id, path: draft.path, message });
    }
    const summary = `Confirmed publication for ${count} of ${drafts.length} selected files.`;
    try {
      await refreshDrafts(summary);
    } catch {
      draftNotice = summary + ' Reload to refresh the list.';
    } finally {
      publishing = false;
    }
  }

  async function refreshDrafts(message) {
    draftNotice = message;
    await invalidateAll();
    const drafts = new Set(data.drafts.map(draft => draft.id));
    for (const id of selected) if (!drafts.has(id)) selected.delete(id);
  }

  async function deleteFile({ id, path }) {
    if (deletingId || !window.confirm(`Permanently delete “${path}”? A new file at this path will use the same share link.`)) return;
    deletingId = id;
    notice = '';
    try {
      const response = await fetch('/api/manage/resources/' + id, { method: 'DELETE' });
      if (response.status !== 204) throw new Error();
    } catch {
      notice = 'Deletion could not be confirmed. Check your sign-in and try again.';
      deletingId = null;
      return;
    }

    try {
      if (data.page > 1 && data.resources.length === 1 && !data.has_next) {
        await goto(data.page === 2 ? '/manage' : `/manage?page=${data.page - 1}`, { refreshAll: true, noScroll: true });
      } else {
        await invalidateAll();
      }
      notice = `Deleted “${path}”.`;
    } catch {
      notice = `Deleted “${path}”. Reload to refresh the list.`;
    } finally {
      deletingId = null;
    }
  }
</script>

<svelte:head><title>Manage files · Wavlark</title></svelte:head>
<h1>Manage files</h1>
<p class="mt-4 muted">Signed in as <strong>{data.email}</strong></p>

<DownloadSettings settings={data.download_settings} />

<details class="mt-8" open>
  <summary class="w-fit cursor-pointer font-semibold text-primary">Upload files</summary>
  <fieldset disabled={publishing}>
    <UploadForm partSize={data.part_size} maxSize={data.max_upload_size} bind:busy={uploading} onrefresh={uploaded} />
  </fieldset>
</details>

<p role="status" class="mt-2 wrap-anywhere text-sm muted">{draftNotice}</p>
{#if errors.length}
  <ul class="mt-2 text-sm wrap-anywhere" aria-label="Publication errors">
    {#each errors as error (error.id)}<li>{error.path} · {error.message}</li>{/each}
  </ul>
{/if}
{#if data.drafts.length}
  <h2 class="mt-10 text-2xl font-semibold">Unpublished drafts</h2>
  <Button class="mt-4" disabled={uploading || publishing || !publishable.length} onclick={publish}>
    {publishing ? 'Publishing…' : `Confirm publication (${publishable.length})`}
  </Button>
  <ul>
    {#each data.drafts as draft (draft.id)}
      <Draft {draft} checked={selected.has(draft.id)} disabled={publishing} bind:uploading
        onselect={checked => select(draft.id, checked)} onuploaded={uploaded} onrefresh={refreshDrafts} />
    {/each}
  </ul>
{/if}

<h2 class="mt-10 text-2xl font-semibold">Published files</h2>
<p role="status" class="mt-2 wrap-anywhere text-sm muted">{notice}</p>
<ResourceList {data} base="/manage">
  {#snippet action(file)}
    <Button variant="outline" href={'/api/manage/resources/' + file.id + '/download'} data-sveltekit-reload
      aria-label={`Download ${file.path}`}>Download</Button>
    <Button variant="outline" aria-label={`Delete ${file.path}`} disabled={deletingId !== null} onclick={() => deleteFile(file)}>
      {deletingId === file.id ? 'Deleting…' : 'Delete'}
    </Button>
  {/snippet}
</ResourceList>

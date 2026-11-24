<script>
  import { goto, invalidateAll } from '$app/navigation';
  import Button from '#lib/components/ui/button/button.svelte';
  import ResourceList from '#lib/components/ResourceList.svelte';
  import Draft from './Draft.svelte';
  import UploadForm from './UploadForm.svelte';

  let { data } = $props();
  let deletingId = $state(null);
  let notice = $state('');
  let draftNotice = $state('');

  async function refreshDrafts(message) {
    draftNotice = message;
    await invalidateAll();
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

<details class="mt-8" open={data.resources.length === 0 && data.page === 1}>
  <summary class="w-fit cursor-pointer font-semibold text-primary">Upload a file</summary>
  <UploadForm partSize={data.part_size} maxSize={data.max_upload_size} onrefresh={refreshDrafts} />
</details>

<p role="status" class="mt-2 wrap-anywhere text-sm muted">{draftNotice}</p>
{#if data.drafts.length}
  <h2 class="mt-10 text-2xl font-semibold">Unpublished drafts</h2>
  <ul>
    {#each data.drafts as draft (draft.id)}
      <Draft {draft} onrefresh={refreshDrafts} />
    {/each}
  </ul>
{/if}

<h2 class="mt-10 text-2xl font-semibold">Published files</h2>
<p role="status" class="mt-2 wrap-anywhere text-sm muted">{notice}</p>
<ResourceList {data} base="/manage">
  {#snippet action(file)}
    <Button variant="outline" aria-label={`Delete ${file.path}`} disabled={deletingId !== null} onclick={() => deleteFile(file)}>
      {deletingId === file.id ? 'Deleting…' : 'Delete'}
    </Button>
  {/snippet}
</ResourceList>

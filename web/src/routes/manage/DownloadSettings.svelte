<script>
  import Button from '#lib/components/ui/button/button.svelte';

  let { settings } = $props();
  let saving = $state(false);
  let notice = $state('');

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    const values = new FormData(event.currentTarget);
    saving = true;
    notice = '';
    try {
      const response = await fetch('/api/manage/download-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_mbps: Number(values.get('public_mbps')),
          admin_mbps: Number(values.get('admin_mbps'))
        })
      });
      if (!response.ok) throw new Error();
      notice = 'Saved. New downloads will use these speeds.';
    } catch {
      notice = 'Could not save download speeds. Check your sign-in and try again.';
    } finally {
      saving = false;
    }
  }
</script>

<details class="mt-6">
  <summary class="w-fit cursor-pointer font-semibold text-primary">Download speeds</summary>
  <form class="mt-4 grid max-w-xl gap-3" onsubmit={save} oninput={() => notice = ''}>
    <p class="muted text-sm">Set the maximum speed for each download. Leave a field empty for unlimited speed.</p>
    <fieldset class="flex flex-wrap gap-4" disabled={saving}>
      {#each [['public_mbps', 'Public'], ['admin_mbps', 'Administrator']] as [key, label]}
        <label class="grid gap-1 text-sm font-semibold">
          {label} (MB/s)
          <input type="number" name={key} min="0.000001" step="any" placeholder="Unlimited"
            value={settings[key] || ''} class="w-40 rounded-md border border-line bg-white p-2 font-normal" />
        </label>
      {/each}
    </fieldset>
    <Button type="submit" class="w-fit" disabled={saving}>{saving ? 'Saving…' : 'Save speeds'}</Button>
    <p role="status" class="text-sm">{notice}</p>
  </form>
</details>

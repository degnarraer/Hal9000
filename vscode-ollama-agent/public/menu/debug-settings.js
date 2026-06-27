async function initDebugSettings() {
  byId('saveDebugSettings')?.addEventListener('click', saveDebugSettings);
  await loadDebugSettings();
}

async function loadDebugSettings() {
  const checkbox = byId('showChatDebugPills');
  const status = byId('debugSettingsStatus');
  if (!checkbox) return;
  if (status) status.textContent = 'Loading debug settings...';

  try {
    const response = await fetchWithAuthRedirect('/api/admin/debug-settings', { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Could not load debug settings');
    checkbox.checked = json.data?.showChatDebugPills !== false;
    if (status) status.textContent = 'Debug settings loaded.';
  } catch (err) {
    if (status) status.textContent = `Debug settings error: ${err.message}`;
  }
}

async function saveDebugSettings() {
  const checkbox = byId('showChatDebugPills');
  const status = byId('debugSettingsStatus');
  if (!checkbox) return;
  if (status) status.textContent = 'Saving debug settings...';

  try {
    const response = await fetchWithAuthRedirect('/api/admin/debug-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showChatDebugPills: checkbox.checked })
    });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Could not save debug settings');
    window.__chat?.applyChatDebugPillVisibility?.(json.data?.showChatDebugPills !== false);
    if (status) status.textContent = json.data?.showChatDebugPills === false
      ? 'Saved. Main chat debug pills are hidden.'
      : 'Saved. Main chat debug pills are visible.';
  } catch (err) {
    if (status) status.textContent = `Save error: ${err.message}`;
  }
}

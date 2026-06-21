function initYahooSkill() {
  byId('linkYahooAccount')?.addEventListener('click', () => {
    window.location.href = '/api/yahoo/oauth/start';
  });
  byId('refreshYahooToken')?.addEventListener('click', refreshYahooToken);
  byId('disconnectYahooAccount')?.addEventListener('click', disconnectYahooAccount);
  fetchYahooAccount();
}

async function fetchYahooAccount() {
  const status = byId('yahooStatus');
  const accountTarget = byId('yahooAccountDetails');
  const accessTarget = byId('yahooAccessDetails');
  if (status) status.textContent = 'Checking Yahoo account link...';

  try {
    const response = await fetchWithAuthRedirect('/api/yahoo/account', { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Yahoo account status unavailable');
    const data = json.data || {};
    const account = data.account;

    byId('refreshYahooToken')?.toggleAttribute('disabled', !data.connected);
    byId('disconnectYahooAccount')?.toggleAttribute('disabled', !data.connected);

    if (!data.configured) {
      if (status) status.textContent = 'Yahoo OAuth is not configured on this server.';
    } else if (data.connected) {
      if (status) status.textContent = 'Yahoo account linked.';
    } else {
      if (status) status.textContent = 'No Yahoo account linked.';
    }

    if (accountTarget) {
      accountTarget.innerHTML = data.connected ? `
        <dl class="detail-list">
          <div><dt>Name</dt><dd>${escapeHtml(account.displayName || 'Yahoo account')}</dd></div>
          <div><dt>Email</dt><dd>${escapeHtml(account.yahooEmail || 'Not provided by Yahoo')}</dd></div>
          <div><dt>Yahoo ID</dt><dd>${escapeHtml(account.yahooGuid || 'Not provided')}</dd></div>
          <div><dt>Linked</dt><dd>${escapeHtml(formatDateTime(account.createdAt))}</dd></div>
          <div><dt>Updated</dt><dd>${escapeHtml(formatDateTime(account.updatedAt))}</dd></div>
          <div><dt>Access token expires</dt><dd>${escapeHtml(formatDateTime(account.expiresAt))}</dd></div>
        </dl>
      ` : '<div class="empty">No Yahoo account linked</div>';
    }

    if (accessTarget) {
      accessTarget.innerHTML = `
        <dl class="detail-list">
          <div><dt>Configured</dt><dd>${data.configured ? 'Yes' : 'No'}</dd></div>
          <div><dt>Requested scope</dt><dd>${escapeHtml(data.scope || 'openid email')}</dd></div>
          <div><dt>Storage</dt><dd>Encrypted OAuth tokens in PostgreSQL</dd></div>
        </dl>
      `;
    }
  } catch (err) {
    if (status) status.textContent = 'Yahoo error: ' + err.message;
    if (accountTarget) accountTarget.innerHTML = '<div class="empty">Yahoo status unavailable</div>';
  }

  window.__icons?.render?.(mainPage);
}

async function refreshYahooToken() {
  const status = byId('yahooStatus');
  const button = byId('refreshYahooToken');
  if (button) button.disabled = true;
  if (status) status.textContent = 'Refreshing Yahoo token...';

  try {
    const response = await fetchWithAuthRedirect('/api/yahoo/oauth/refresh', { method: 'POST' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Yahoo token refresh failed');
    await fetchYahooAccount();
  } catch (err) {
    if (status) status.textContent = 'Yahoo refresh error: ' + err.message;
  } finally {
    if (button) button.disabled = false;
  }
}

async function disconnectYahooAccount() {
  const confirmed = await window.__dialog.confirm({
    title: 'Disconnect Yahoo',
    message: 'Disconnect Yahoo and delete the stored OAuth tokens?',
    confirmText: 'Disconnect'
  });
  if (!confirmed) return;

  const status = byId('yahooStatus');
  const button = byId('disconnectYahooAccount');
  if (button) button.disabled = true;
  if (status) status.textContent = 'Disconnecting Yahoo...';

  try {
    const response = await fetchWithAuthRedirect('/api/yahoo/oauth/disconnect', { method: 'POST' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Yahoo disconnect failed');
    await fetchYahooAccount();
  } catch (err) {
    if (status) status.textContent = 'Yahoo disconnect error: ' + err.message;
  } finally {
    if (button) button.disabled = false;
  }
}

function formatDateTime(value) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString();
}

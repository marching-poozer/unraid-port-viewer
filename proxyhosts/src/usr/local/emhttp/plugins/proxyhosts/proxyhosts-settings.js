// Wires ProxyHostsSettings.page's "Save & Test" buttons to
// include/save-settings.php.

(function () {
  const CSRF = window.PH_CSRF_TOKEN || '';

  // Real form field, not JSON - see proxyhosts.js's api() for why.
  async function post(body) {
    const res = await fetch('/plugins/proxyhosts/include/save-settings.php', {
      method: 'POST',
      body: new URLSearchParams({ csrf_token: CSRF, data: JSON.stringify(body) }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) throw new Error((data && data.error) || 'HTTP ' + res.status);
    return data;
  }

  function wire(buttonId, statusId, build) {
    const btn = document.getElementById(buttonId);
    const status = document.getElementById(statusId);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      status.textContent = 'Testing…';
      status.className = 'ph-status';
      try {
        await post(build());
        status.textContent = 'Saved.';
        status.classList.add('ph-status-ok');
      } catch (e) {
        status.textContent = 'Failed: ' + e.message;
        status.classList.add('ph-status-err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  wire('ph-save-npm', 'ph-npm-status', () => ({
    section: 'npm',
    origin: document.getElementById('ph-npm-origin').value.trim(),
    identity: document.getElementById('ph-npm-identity').value.trim(),
    secret: document.getElementById('ph-npm-secret').value,
  }));

  wire('ph-save-pihole', 'ph-pihole-status', () => ({
    section: 'pihole',
    enabled: document.getElementById('ph-pihole-enabled').checked,
    origin: document.getElementById('ph-pihole-origin').value.trim(),
    password: document.getElementById('ph-pihole-password').value,
  }));

  document.getElementById('ph-base-domain').addEventListener('change', (e) => {
    post({ section: 'base_domain', base_domain: e.target.value.trim() }).catch(() => {});
  });

  wire('ph-save-forwarding', 'ph-forwarding-status', () => ({
    section: 'forwarding',
    enabled: document.getElementById('ph-prefer-container-forwarding').checked,
    shared_network: document.getElementById('ph-shared-network').value.trim(),
  }));
})();

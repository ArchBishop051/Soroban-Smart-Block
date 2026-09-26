const baseUrl = (() => {
  const override = localStorage.getItem('EXPLORER_ORIGIN');
  if (override && override.trim()) return override.trim().replace(/\/$/, '');
  return 'http://localhost:5173';
})();

function resolveBrowseUrl(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;

  if (/^[GMC][A-Z2-7]{55,}$/.test(trimmed)) {
    if (trimmed.startsWith('C')) {
      return `${baseUrl}/contract/${encodeURIComponent(trimmed)}`;
    }
    return `${baseUrl}/wallet/${encodeURIComponent(trimmed)}`;
  }

  if (/^[A-Za-z0-9]{1,64}$/.test(trimmed) && /^M/.test(trimmed)) {
    return `${baseUrl}/wallet/${encodeURIComponent(trimmed)}`;
  }

  return null;
}

function openTarget() {
  const value = document.getElementById('value').value;
  const url = resolveBrowseUrl(value);
  const statusEl = document.getElementById('status');

  if (!url) {
    statusEl.textContent = 'Enter a valid Stellar wallet address or contract ID.';
    return;
  }

  statusEl.textContent = 'Opening…';
  chrome.tabs.create({ url });
}

document.getElementById('jump').addEventListener('click', openTarget);
document.getElementById('value').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') openTarget();
});

async function pasteSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const text = window.getSelection?.()?.toString?.() ?? '';
        return text.trim() || document.activeElement?.value || '';
      },
    });

    const value = results[0]?.result || '';
    if (value) {
      document.getElementById('value').value = value;
    }
  } catch {
    // Ignore clipboard/selection failures gracefully.
  }
}

pasteSelection();

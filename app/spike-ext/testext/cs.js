document.documentElement.dataset.spikeCs = 'ran';
chrome.runtime.sendMessage({ hi: 1 }, (r) => {
  document.documentElement.dataset.spikeBg = JSON.stringify(r || chrome.runtime.lastError?.message || null);
});

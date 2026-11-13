// Runs before first paint so the saved theme never flashes the wrong colors.
// 'light' or 'dark' is stored in localStorage; nothing stored = follow the system.
try {
  const t = localStorage.getItem('theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* storage unavailable: follow the system theme */ }

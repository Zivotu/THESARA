export const PLAY_WRAPPER_JS = `(() => {
  const id = document.body.dataset.appId;
  try {
    const key = 'pendingScore-' + id;
    const val = localStorage.getItem(key);
    if (val != null) {
      fetch('/apps/' + id + '/score', {
        method: 'POST',
        headers: {"Content-Type": "application/json"},
        credentials: 'include',
        body: JSON.stringify({ score: Number(val) })
      }).then(() => localStorage.removeItem(key)).catch(() => {});
    }
  } catch (e) {}

  window.addEventListener('loopyway:login-required', () => {
    const el = document.getElementById('login-banner');
    if (el) el.style.display = 'block';
  });

  fetch('/apps/' + id + '/leaderboard?limit=10')
    .then(r => r.json())
    .then(j => {
      const list = j.scores || [];
      const box = document.createElement('div');
      box.style.position = 'absolute';
      box.style.bottom = '0';
      box.style.left = '0';
      box.style.right = '0';
      box.style.maxHeight = '50%';
      box.style.overflow = 'auto';
      box.style.background = 'rgba(0,0,0,0.7)';
      box.style.color = '#fff';
      box.style.fontFamily = 'sans-serif';
      let html = '<h3 style="margin:4px">Top 10</h3><ol style="margin:4px">';
      list.forEach(s => { html += '<li>' + s.uid + ': ' + s.score + '</li>'; });
      html += '</ol>';
      box.innerHTML = html;
      document.body.appendChild(box);
    })
    .catch(() => {});
})();
`;

'use client';

export function triggerConfetti() {
  const colors = ['#10B981', '#F87171', '#FBBF24', '#60A5FA', '#34D399'];
  const amount = 30;
  for (let i = 0; i < amount; i++) {
    const el = document.createElement('span');
    el.className = 'confetti-piece';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    el.style.animationDuration = 1 + Math.random() * 2 + 's';
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
}

export default triggerConfetti;

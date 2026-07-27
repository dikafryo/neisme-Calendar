// sticky-colors.js — 🆕 v26.0728.1
// 메모 그리드 카드와 스티커 메모 창(sticky.html)이 공유하는 포스트잇 색상 팔레트.
// 메모 id를 해시해서 같은 메모는 항상 같은 색이 나오게 함.

window.STICKY_PALETTE = ['#fff6b7', '#ffd6e0', '#c8f0d0', '#c9e4ff', '#ffe0b8', '#e3d4ff'];

window.stickyColorFor = function stickyColorFor(id) {
  const s = String(id || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return window.STICKY_PALETTE[h % window.STICKY_PALETTE.length];
};

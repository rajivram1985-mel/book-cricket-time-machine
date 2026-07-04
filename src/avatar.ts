import type { Player } from './types';

/**
 * Stylized inline-SVG avatar: era/country gradient disc, initials, and the
 * player's signature emoji. No photo licensing, works offline; swap in real
 * images later by replacing this function's output.
 */
export function avatarSvg(player: Player, size = 64): string {
  const initials = player.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const gid = `g-${player.id}`;
  return `
<svg class="avatar" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="${player.name}">
  <defs>
    <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${player.avatar.color1}"/>
      <stop offset="100%" stop-color="${player.avatar.color2}"/>
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="30" fill="url(#${gid})" stroke="rgba(0,0,0,.25)" stroke-width="2"/>
  <text x="32" y="30" text-anchor="middle" font-family="Georgia, serif" font-size="20" font-weight="bold" fill="#fff" style="text-shadow:0 1px 2px rgba(0,0,0,.4)">${initials}</text>
  <text x="32" y="52" text-anchor="middle" font-size="16">${player.avatar.emoji}</text>
</svg>`;
}

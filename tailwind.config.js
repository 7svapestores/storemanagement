/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Design System v2 — CSS variable-based
        'v2-bg': 'var(--bg-base)',
        'v2-elevated': 'var(--bg-elevated)',
        'v2-card': 'var(--bg-card)',
        'v2-hover': 'var(--bg-hover)',
        'v2-border': 'var(--border-subtle)',
        'v2-border-d': 'var(--border-default)',
        'v2-text': 'var(--text-primary)',
        'v2-sub': 'var(--text-secondary)',
        'v2-muted': 'var(--text-muted)',
        'v2-brand': 'var(--brand-primary)',
        'v2-success': 'var(--color-success)',
        'v2-warning': 'var(--color-warning)',
        'v2-danger': 'var(--color-danger)',
        'v2-info': 'var(--color-info)',
        // Existing sw-* colors preserved
        sw: {
          bg: '#060A10',
          card: '#0C1219',
          card2: '#131C28',
          border: '#1A2536',
          text: '#E2E8F0',
          sub: '#94A3B8',
          dim: '#475569',
          blue: '#39FF14',
          blueD: 'rgba(57,255,20,0.14)',
          green: '#34D399',
          greenD: 'rgba(52,211,153,0.10)',
          red: '#F87171',
          redD: 'rgba(248,113,113,0.10)',
          amber: '#FBBF24',
          amberD: 'rgba(251,191,36,0.10)',
          cyan: '#22D3EE',
          purple: '#C084FC',
          pink: '#FF1493',
          pinkD: 'rgba(255,20,147,0.14)',
        },
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

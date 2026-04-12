/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        sw: {
          bg: '#060A10',
          card: '#0C1219',
          card2: '#131C28',
          border: '#1A2536',
          text: '#E2E8F0',
          sub: '#94A3B8',
          dim: '#475569',
          blue: '#60A5FA',
          blueD: 'rgba(96,165,250,0.12)',
          green: '#34D399',
          greenD: 'rgba(52,211,153,0.10)',
          red: '#F87171',
          redD: 'rgba(248,113,113,0.10)',
          amber: '#FBBF24',
          amberD: 'rgba(251,191,36,0.10)',
          cyan: '#22D3EE',
          purple: '#C084FC',
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

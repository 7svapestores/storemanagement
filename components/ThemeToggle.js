'use client';
import { useTheme } from '@/contexts/ThemeContext';

export default function ThemeToggle() {
  const { theme, changeTheme } = useTheme();

  const opts = [
    { id: 'light', icon: '☀️', label: 'Light' },
    { id: 'dark', icon: '🌙', label: 'Dark' },
    { id: 'auto', icon: '💻', label: 'Auto' },
  ];

  return (
    <div className="flex border border-sw-border rounded-md overflow-hidden">
      {opts.map(o => (
        <button
          key={o.id}
          onClick={() => changeTheme(o.id)}
          title={`${o.label} mode`}
          className={`px-2 py-1 text-[11px] transition-colors ${
            theme === o.id
              ? 'bg-sw-blueD text-sw-blue font-semibold'
              : 'bg-sw-card2 text-sw-dim hover:text-sw-text'
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

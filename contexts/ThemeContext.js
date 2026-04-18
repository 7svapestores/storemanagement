'use client';
import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext({ theme: 'dark', resolvedTheme: 'dark', changeTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('dark');
  const [resolvedTheme, setResolvedTheme] = useState('dark');

  useEffect(() => {
    const saved = localStorage.getItem('7s-theme') || 'dark';
    setTheme(saved);
  }, []);

  useEffect(() => {
    let actual = theme;
    if (theme === 'auto') {
      actual = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    setResolvedTheme(actual);
    document.documentElement.setAttribute('data-theme', actual);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      const actual = e.matches ? 'dark' : 'light';
      setResolvedTheme(actual);
      document.documentElement.setAttribute('data-theme', actual);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const changeTheme = (t) => {
    setTheme(t);
    localStorage.setItem('7s-theme', t);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, changeTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

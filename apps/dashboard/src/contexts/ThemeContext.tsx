import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark' | 'auto';

interface ThemeContextType {
  theme: Theme;
  actualTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme');
    return (saved as Theme) || 'auto';
  });

  const [actualTheme, setActualTheme] = useState<'light' | 'dark'>('light');

  // 计算实际主题
  useEffect(() => {
    const calculateActualTheme = () => {
      if (theme === 'auto') {
        const hour = new Date().getHours();
        // 18:00-7:00 使用深色模式
        return hour >= 18 || hour < 7 ? 'dark' : 'light';
      }
      return theme;
    };

    setActualTheme(calculateActualTheme());

    // 如果是 auto 模式，每分钟检查一次
    if (theme === 'auto') {
      const timer = setInterval(() => {
        setActualTheme(calculateActualTheme());
      }, 60000);
      return () => clearInterval(timer);
    }
  }, [theme]);

  // 应用主题到 document
  useEffect(() => {
    if (actualTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [actualTheme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, actualTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

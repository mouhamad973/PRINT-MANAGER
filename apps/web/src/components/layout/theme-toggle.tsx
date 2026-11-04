'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { IconButton } from '@/components/ui/button';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  // Les deux icônes sont rendues et le CSS choisit : le serveur ne connaît pas le thème.
  return (
    <IconButton
      aria-label="Basculer entre le thème clair et le thème sombre"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="hidden dark:block" aria-hidden="true" />
      <Moon className="dark:hidden" aria-hidden="true" />
    </IconButton>
  );
}

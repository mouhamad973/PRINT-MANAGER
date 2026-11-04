'use client';

import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from './input';

interface SearchInputProps {
  label: string;
  placeholder?: string;
  /** Recherche initiale, par exemple reçue dans l'URL. */
  defaultValue?: string;
  onSearch: (value: string) => void;
}

/** Recherche déclenchée 300 ms après la dernière frappe : une requête par intention, pas par touche. */
export function SearchInput({ label, placeholder, defaultValue = '', onSearch }: SearchInputProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const timer = setTimeout(() => onSearch(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value, onSearch]);

  return (
    <div className="relative w-full sm:w-72">
      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="rounded-full bg-surface-raised pl-10"
      />
    </div>
  );
}

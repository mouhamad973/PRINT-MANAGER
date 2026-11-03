'use client';

import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from './input';

interface SearchInputProps {
  label: string;
  placeholder?: string;
  onSearch: (value: string) => void;
}

/** Recherche déclenchée 300 ms après la dernière frappe : une requête par intention, pas par touche. */
export function SearchInput({ label, placeholder, onSearch }: SearchInputProps) {
  const [value, setValue] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => onSearch(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value, onSearch]);

  return (
    <div className="relative w-full max-w-xs">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="pl-9"
      />
    </div>
  );
}

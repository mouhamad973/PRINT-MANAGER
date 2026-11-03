'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const INKS = [
  { key: 'cyan', label: 'Cyan', color: 'var(--ink-cyan)' },
  { key: 'magenta', label: 'Magenta', color: 'var(--ink-magenta)' },
  { key: 'yellow', label: 'Jaune', color: 'var(--ink-yellow)' },
  { key: 'black', label: 'Noir', color: 'var(--ink-black)' },
];

// Valeurs arbitraires, uniquement pour montrer le style des graphiques.
const EXAMPLE_DATA = [
  { period: 'P1', cyan: 42, magenta: 38, yellow: 31, black: 64 },
  { period: 'P2', cyan: 48, magenta: 35, yellow: 37, black: 59 },
  { period: 'P3', cyan: 39, magenta: 44, yellow: 33, black: 71 },
  { period: 'P4', cyan: 51, magenta: 41, yellow: 29, black: 66 },
];

export function ExampleChart() {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={EXAMPLE_DATA} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="period"
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={32}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              borderRadius: 5,
              color: 'var(--foreground)',
              fontSize: 13,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          {INKS.map((ink) => (
            <Bar
              key={ink.key}
              dataKey={ink.key}
              name={ink.label}
              fill={ink.color}
              radius={[2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

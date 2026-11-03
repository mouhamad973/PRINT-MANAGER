import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ExampleChart } from '@/features/design-system/example-chart';
import { ExampleForm } from '@/features/design-system/example-form';

export const metadata: Metadata = { title: 'Design system' };

const NEUTRALS = ['background', 'surface', 'muted', 'border', 'input', 'foreground'];
const SEMANTIC = ['primary', 'success', 'warning', 'danger'];
const INKS = [
  { name: 'Cyan', token: 'ink-cyan' },
  { name: 'Magenta', token: 'ink-magenta' },
  { name: 'Jaune', token: 'ink-yellow' },
  { name: 'Noir', token: 'ink-black' },
];

function Swatch({ name, token }: { name: string; token: string }) {
  return (
    <li>
      <div
        className="h-12 rounded-md border border-border"
        style={{ backgroundColor: `var(--${token})` }}
      />
      <p className="mt-1.5 text-xs text-muted-foreground">{name}</p>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold">Design system</h1>
        <p className="mt-1 max-w-[65ch] text-muted-foreground">
          Les composants et les couleurs de l’application, dans le thème actif. Les encres CMJN sont
          réservées aux données : jamais au texte ni aux actions.
        </p>
      </div>

      <Section title="Couleurs">
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {NEUTRALS.map((token) => (
            <Swatch key={token} name={token} token={token} />
          ))}
        </ul>
        <ul className="grid grid-cols-4 gap-3 sm:grid-cols-6">
          {SEMANTIC.map((token) => (
            <Swatch key={token} name={token} token={token} />
          ))}
        </ul>
        <ul className="grid grid-cols-4 gap-3 sm:grid-cols-6">
          {INKS.map((ink) => (
            <Swatch key={ink.token} name={ink.name} token={ink.token} />
          ))}
        </ul>
      </Section>

      <Section title="Typographie">
        <div className="space-y-1.5">
          <p className="text-xl font-semibold">Titre de page, 20 px semi-gras</p>
          <p className="text-base font-semibold">Titre de section, 16 px semi-gras</p>
          <p>Texte courant, 14 px : les tableaux restent denses et lisibles toute la journée.</p>
          <p className="text-xs text-muted-foreground">Libellé secondaire, 12 px</p>
          <p className="tabular-nums">Chiffres tabulaires : 1 284,50 g · 96,12 g · 0,0375 €</p>
        </div>
      </Section>

      <Section title="Actions">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Enregistrer</Button>
          <Button variant="secondary">Annuler</Button>
          <Button variant="ghost">Filtrer</Button>
          <Button variant="danger">Supprimer</Button>
          <Button disabled>Indisponible</Button>
          <Button size="sm" variant="secondary">
            Petit format
          </Button>
        </div>
      </Section>

      <Section title="États">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="success">En ligne</Badge>
          <Badge tone="warning">Toner bas</Badge>
          <Badge tone="danger">Hors ligne</Badge>
          <Badge>Inconnu</Badge>
        </div>
        <Skeleton className="h-5 max-w-sm" />
      </Section>

      <Section title="Champs de saisie">
        <div className="grid max-w-md gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ds-normal">Champ normal</Label>
            <Input id="ds-normal" placeholder="Saisissez une valeur" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ds-disabled">Champ désactivé</Label>
            <Input id="ds-disabled" disabled defaultValue="Valeur verrouillée" />
          </div>
        </div>
      </Section>

      <Section title="Formulaire (React Hook Form et Zod)">
        <Panel className="max-w-md p-4">
          <ExampleForm />
        </Panel>
      </Section>

      <Section title="Tableau">
        <p className="text-xs text-muted-foreground">Contenu d’exemple, sans donnée réelle.</p>
        <Panel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Machine</TableHead>
                <TableHead>État</TableHead>
                <TableHead className="text-right">Pages</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Exemple A</TableCell>
                <TableCell>
                  <Badge tone="success">En ligne</Badge>
                </TableCell>
                <TableCell className="text-right">128 450</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Exemple B</TableCell>
                <TableCell>
                  <Badge tone="danger">Hors ligne</Badge>
                </TableCell>
                <TableCell className="text-right">9 302</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Panel>
      </Section>

      <Section title="Graphique (Recharts)">
        <p className="text-xs text-muted-foreground">Valeurs d’exemple, sans donnée réelle.</p>
        <Panel className="p-4">
          <ExampleChart />
        </Panel>
      </Section>
    </div>
  );
}

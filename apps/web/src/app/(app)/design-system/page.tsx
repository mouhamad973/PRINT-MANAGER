import type { Metadata } from 'next';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { StatCard } from '@/components/ui/stat-card';
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

const NEUTRALS = ['background', 'surface', 'surface-raised', 'muted', 'border', 'foreground'];
const SEMANTIC = ['primary', 'primary-soft', 'success', 'warning', 'danger'];
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
        className="h-14 rounded-lg border border-border"
        style={{ backgroundColor: `var(--${token})` }}
      />
      <p className="mt-1.5 text-xs text-muted-foreground">{name}</p>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-[-0.015em]">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        title="Design system"
        description="Les composants et les couleurs de l’application, dans le thème actif. Les encres CMJN sont réservées aux données : jamais au texte ni aux actions."
      />

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
          <p className="text-[2rem] leading-tight font-semibold tracking-[-0.03em]">
            Titre de page, 32 px
          </p>
          <p className="text-[2.5rem] leading-none font-semibold tracking-[-0.035em] tabular-nums">
            1 284 <span className="text-lg font-medium text-muted-foreground">pages</span>
          </p>
          <p className="text-base font-semibold">Titre de panneau, 16 px semi-gras</p>
          <p>Texte courant, 14 px : les tableaux restent denses et lisibles toute la journée.</p>
          <p className="text-xs text-muted-foreground">Libellé secondaire, 12 px</p>
          <p className="tabular-nums">Chiffres tabulaires : 1 284,50 g · 96,12 g · 0,0375 €</p>
        </div>
      </Section>

      <Section title="Indicateurs">
        <p className="text-xs text-muted-foreground">Valeurs d’exemple, sans donnée réelle.</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            featured
            label="Carte vedette"
            value="24"
            hint="Une seule par page, pour l’indicateur principal"
          />
          <StatCard label="Carte standard" value="10" hint="Libellé, valeur, contexte" />
          <StatCard
            label="Avec unité"
            value="3"
            unit="ms"
            hint={
              <Badge tone="success">
                <StatusDot />
                Exemple de variation
              </Badge>
            }
          />
          <StatCard label="Valeur inconnue" value="—" hint="Jamais de zéro inventé" />
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
          <Badge tone="brand">Marque</Badge>
          <Badge tone="success">
            <StatusDot />
            En ligne
          </Badge>
          <Badge tone="warning">
            <StatusDot />
            Toner bas
          </Badge>
          <Badge tone="danger">
            <StatusDot />
            Hors ligne
          </Badge>
          <Badge>Inconnu</Badge>
        </div>
        <Skeleton className="h-5 max-w-sm" />
      </Section>

      <Section title="Champs de saisie">
        <div className="grid max-w-md gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ds-normal">Champ normal</Label>
            <Input id="ds-normal" placeholder="Saisissez une valeur" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ds-disabled">Champ désactivé</Label>
            <Input id="ds-disabled" disabled defaultValue="Valeur verrouillée" />
          </div>
        </div>
      </Section>

      <Section title="Formulaire (React Hook Form et Zod)">
        <Panel className="max-w-md p-5">
          <ExampleForm />
        </Panel>
      </Section>

      <Section title="Tableau">
        <Panel>
          <PanelHeader title="Machines" description="Contenu d’exemple, sans donnée réelle." />
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
                  <Badge tone="success">
                    <StatusDot />
                    En ligne
                  </Badge>
                </TableCell>
                <TableCell className="text-right">128 450</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Exemple B</TableCell>
                <TableCell>
                  <Badge tone="danger">
                    <StatusDot />
                    Hors ligne
                  </Badge>
                </TableCell>
                <TableCell className="text-right">9 302</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Panel>
      </Section>

      <Section title="Graphique (Recharts)">
        <Panel>
          <PanelHeader
            title="Consommation par encre"
            description="Valeurs d’exemple, sans donnée réelle."
          />
          <div className="px-3 pb-4">
            <ExampleChart />
          </div>
        </Panel>
      </Section>
    </div>
  );
}

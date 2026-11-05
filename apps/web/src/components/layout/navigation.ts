import type { CurrentUser, Permission } from '@arksen/shared-types';
import { hasPermission } from '@arksen/shared-types';
import {
  Activity,
  AlertTriangle,
  Blocks,
  BookOpenText,
  Building2,
  ClipboardList,
  Droplets,
  FileBarChart,
  FileSearch,
  FileSignature,
  Gauge,
  HardHat,
  LayoutDashboard,
  MapPin,
  Package,
  Palette,
  Printer,
  RadioTower,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  SwatchBook as Swatches,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Route du module. Absente tant que le module n'est pas livré. */
  href?: string;
  /** Phase de livraison, affichée tant que le module n'est pas disponible. */
  phase?: number;
  /** Module masqué si le rôle n'a pas cette permission. */
  permission?: Permission;
  /** Module propre à une entreprise : masqué pour un compte de plateforme. */
  tenantScoped?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Les 20 modules fonctionnels du cahier des charges, plus les pages du socle, les fiches techniques
 * et les agents de collecte (agent Windows, § 8 du cahier des charges).
 */
export const NAVIGATION: NavGroup[] = [
  {
    label: 'Supervision',
    items: [
      {
        label: 'Tableau de bord',
        icon: LayoutDashboard,
        href: '/dashboard',
        permission: 'printers:read',
      },
      { label: 'État de la plateforme', icon: Activity, href: '/' },
      { label: 'Alertes', icon: AlertTriangle, href: '/alertes', permission: 'alerts:read' },
    ],
  },
  {
    label: 'Parc',
    items: [
      {
        label: 'Entreprises clientes',
        icon: Building2,
        href: '/tenants',
        permission: 'platform:tenants:manage',
      },
      { label: 'Sites', icon: MapPin, href: '/sites', permission: 'sites:read' },
      { label: 'Machines', icon: Printer, href: '/machines', permission: 'printers:read' },
      {
        label: 'Fiches techniques',
        icon: BookOpenText,
        href: '/printer-models',
        permission: 'printers:read',
      },
      { label: 'Compteurs', icon: Gauge, href: '/meters', permission: 'meters:read' },
      {
        label: 'Agents de collecte',
        icon: RadioTower,
        href: '/collecte',
        permission: 'agents:read',
      },
      // Registre des travaux imprimés, de leur coût de revient et de leur marge.
      {
        label: 'Impressions',
        icon: ClipboardList,
        href: '/impressions',
        permission: 'costs:read',
      },
    ],
  },
  {
    label: 'Consommation',
    items: [
      { label: 'Aplat CMJN', icon: Palette, href: '/aplat', permission: 'consumption:read' },
      {
        label: 'Consommation toner',
        icon: Droplets,
        href: '/consumption',
        permission: 'consumption:read',
      },
      { label: 'Analyse PDF', icon: FileSearch, href: '/analyses', permission: 'print-jobs:read' },
    ],
  },
  {
    label: 'Stocks',
    items: [
      { label: 'Toners', icon: Blocks, href: '/toners', permission: 'stocks:read' },
      { label: 'Stocks', icon: Package, href: '/stocks', permission: 'stocks:read' },
      { label: 'Papier', icon: ScrollText, href: '/papier', permission: 'stocks:read' },
    ],
  },
  {
    label: 'Gestion',
    items: [
      { label: 'Coûts d’impression', icon: Receipt, href: '/couts', permission: 'costs:read' },
      { label: 'Contrats', icon: FileSignature, href: '/contrats', permission: 'contracts:read' },
      {
        label: 'Maintenance',
        icon: Wrench,
        href: '/maintenance',
        permission: 'interventions:read',
      },
      {
        label: 'Interventions',
        icon: HardHat,
        href: '/interventions',
        permission: 'interventions:read',
      },
      { label: 'Rapports', icon: FileBarChart, phase: 10 },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        label: 'Utilisateurs et permissions',
        icon: Users,
        href: '/users',
        permission: 'users:read',
        tenantScoped: true,
      },
      { label: 'Journal d’audit', icon: ShieldCheck, href: '/audit', permission: 'audit:read' },
      { label: 'Administration système', icon: Settings, phase: 10 },
      { label: 'Design system', icon: Swatches, href: '/design-system' },
    ],
  },
];

/** Navigation de l'utilisateur connecté : les modules livrés qu'il n'a pas le droit d'ouvrir disparaissent. */
export function navigationFor(current: CurrentUser): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.permission || hasPermission(current.user.role, item.permission)) &&
        (!item.tenantScoped || current.tenant !== null),
    ),
  })).filter((group) => group.items.length > 0);
}

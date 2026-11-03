import type { CurrentUser, Permission } from '@arksen/shared-types';
import { hasPermission } from '@arksen/shared-types';
import {
  Activity,
  AlertTriangle,
  Blocks,
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

/** Les 20 modules fonctionnels du cahier des charges, plus les pages du socle. */
export const NAVIGATION: NavGroup[] = [
  {
    label: 'Supervision',
    items: [
      { label: 'État de la plateforme', icon: Activity, href: '/' },
      { label: 'Tableau de bord', icon: LayoutDashboard, phase: 3 },
      { label: 'Alertes', icon: AlertTriangle, phase: 8 },
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
      { label: 'Sites', icon: MapPin, phase: 3 },
      { label: 'Machines', icon: Printer, phase: 3 },
      { label: 'Compteurs', icon: Gauge, phase: 4 },
      { label: 'Impressions', icon: ClipboardList, phase: 4 },
    ],
  },
  {
    label: 'Consommation',
    items: [
      { label: 'Aplat CMJN', icon: Palette, phase: 5 },
      { label: 'Consommation toner', icon: Droplets, phase: 5 },
      { label: 'Analyse PDF', icon: FileSearch, phase: 6 },
    ],
  },
  {
    label: 'Stocks',
    items: [
      { label: 'Toners', icon: Blocks, phase: 8 },
      { label: 'Stocks', icon: Package, phase: 8 },
      { label: 'Papier', icon: ScrollText, phase: 9 },
    ],
  },
  {
    label: 'Gestion',
    items: [
      { label: 'Coûts d’impression', icon: Receipt, phase: 9 },
      { label: 'Contrats', icon: FileSignature, phase: 9 },
      { label: 'Maintenance', icon: Wrench, phase: 9 },
      { label: 'Interventions', icon: HardHat, phase: 9 },
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

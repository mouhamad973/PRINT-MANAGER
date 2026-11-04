import { TENANT_ROLES, TENANT_STATUSES, USER_STATUSES } from '@arksen/shared-types';
import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Longueur plutôt que règles de composition, conformément aux recommandations NIST SP 800-63B. */
export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`,
  )
  .max(
    PASSWORD_MAX_LENGTH,
    `Le mot de passe ne peut pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`,
  );

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Saisissez une adresse e-mail valide.'));

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Saisissez au moins 2 caractères.')
  .max(120, '120 caractères maximum.');

/** Champ facultatif : une saisie vide devient `null`. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max} caractères maximum.`)
    .nullish()
    .transform((value) => (value ? value : null));

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Saisissez votre mot de passe.'),
});

export const slugSchema = z
  .string()
  .trim()
  .min(2, 'Saisissez au moins 2 caractères.')
  .max(60, '60 caractères maximum.')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Minuscules, chiffres et tirets uniquement.');

const tenantFields = {
  name: nameSchema,
  contactName: optionalText(120),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .nullish()
    .transform((value) => (value ? value : null))
    .pipe(z.email('Saisissez une adresse e-mail valide.').nullable()),
  contactPhone: optionalText(40),
  address: optionalText(200),
  city: optionalText(100),
  country: optionalText(100),
};

export const tenantCreateSchema = z.object({ ...tenantFields, slug: slugSchema });

export const tenantUpdateSchema = z
  .object({ ...tenantFields, status: z.enum(TENANT_STATUSES) })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Aucune modification fournie.');

export const userCreateSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  role: z.enum(TENANT_ROLES, 'Choisissez un rôle.'),
  password: passwordSchema,
});

export const userUpdateSchema = z
  .object({
    name: nameSchema,
    role: z.enum(TENANT_ROLES, 'Choisissez un rôle.'),
    status: z.enum(USER_STATUSES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Aucune modification fournie.');

export const passwordResetSchema = z.object({ password: passwordSchema });

export const profileUpdateSchema = z.object({ name: nameSchema });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Saisissez votre mot de passe actuel.'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Les deux mots de passe ne correspondent pas.',
    path: ['confirmPassword'],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'Le nouveau mot de passe doit différer de l’actuel.',
    path: ['newPassword'],
  });

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => value || undefined),
});

export const tenantListQuerySchema = listQuerySchema.extend({
  status: z.enum(TENANT_STATUSES).optional(),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type TenantCreateInput = z.infer<typeof tenantCreateSchema>;
export type TenantUpdateInput = z.infer<typeof tenantUpdateSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type TenantListQuery = z.infer<typeof tenantListQuerySchema>;

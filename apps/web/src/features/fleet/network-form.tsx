'use client';

import {
  SNMP_AUTH_PROTOCOLS,
  SNMP_PRIV_PROTOCOLS,
  SNMP_SECURITY_LEVEL_LABELS,
  SNMP_SECURITY_LEVELS,
  SNMP_VERSION_LABELS,
  SNMP_VERSIONS,
  type PrinterConnection,
} from '@arksen/shared-types';
import { printerConnectionSchema, type PrinterConnectionInput } from '@arksen/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, useWatch, type Resolver } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { describedBy, Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/api';

const SECRETS = ['snmpCommunity', 'snmpAuthPassword', 'snmpPrivPassword'] as const;

interface FormValues {
  ipAddress: string;
  hostname: string;
  macAddress: string;
  snmpVersion: (typeof SNMP_VERSIONS)[number];
  snmpPort: string;
  snmpCommunity: string;
  snmpUsername: string;
  snmpSecurityLevel: string;
  snmpAuthProtocol: string;
  snmpAuthPassword: string;
  snmpPrivProtocol: string;
  snmpPrivPassword: string;
}

/** Un secret laissé vide est conservé côté serveur : il n'est donc pas envoyé. */
const formSchema = z.preprocess((raw) => {
  const values = { ...(raw as Record<string, unknown>) };
  for (const secret of SECRETS) {
    if (values[secret] === '') delete values[secret];
  }
  for (const key of ['snmpSecurityLevel', 'snmpAuthProtocol', 'snmpPrivProtocol']) {
    if (values[key] === '') values[key] = null;
  }
  return values;
}, printerConnectionSchema);

function toValues(connection: PrinterConnection | null): FormValues {
  return {
    ipAddress: connection?.ipAddress ?? '',
    hostname: connection?.hostname ?? '',
    macAddress: connection?.macAddress ?? '',
    snmpVersion: connection?.snmpVersion ?? 'V2C',
    snmpPort: String(connection?.snmpPort ?? 161),
    snmpCommunity: '',
    snmpUsername: connection?.snmpUsername ?? '',
    snmpSecurityLevel: connection?.snmpSecurityLevel ?? '',
    snmpAuthProtocol: connection?.snmpAuthProtocol ?? '',
    snmpAuthPassword: '',
    snmpPrivProtocol: connection?.snmpPrivProtocol ?? '',
    snmpPrivPassword: '',
  };
}

interface NetworkFormProps {
  connection: PrinterConnection | null;
  onSubmit: (values: PrinterConnectionInput) => Promise<unknown>;
  onClear: () => void;
}

export function NetworkForm({ connection, onSubmit, onClear }: NetworkFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues, unknown, PrinterConnectionInput>({
    resolver: zodResolver(formSchema as never) as unknown as Resolver<
      FormValues,
      unknown,
      PrinterConnectionInput
    >,
    defaultValues: toValues(connection),
  });

  useEffect(() => reset(toValues(connection)), [connection, reset]);

  const version = useWatch({ control, name: 'snmpVersion' });
  const level = useWatch({ control, name: 'snmpSecurityLevel' });
  const v3 = version === 'V3';
  const auth = v3 && (level === 'AUTH_NO_PRIV' || level === 'AUTH_PRIV');
  const priv = v3 && level === 'AUTH_PRIV';
  /** Le secret enregistré ne vaut que si la version n'a pas changé. */
  const sameVersion = connection?.snmpVersion === version;

  async function submit(values: PrinterConnectionInput) {
    setFormError(null);
    setNotice(null);
    try {
      await onSubmit(values);
      setNotice('Configuration enregistrée. Les secrets sont chiffrés et ne sont plus affichés.');
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  const field = (name: keyof FormValues) => {
    const id = `network-${name}`;
    const error = (errors as Record<string, { message?: string } | undefined>)[name]?.message;
    return {
      id,
      error,
      props: {
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': describedBy(id, error),
        ...register(name),
      },
    };
  };

  const secretField = (name: (typeof SECRETS)[number], label: string, stored: boolean) => {
    const { id, error, props } = field(name);
    return (
      <Field
        id={id}
        label={label}
        error={error}
        hint={stored ? 'Enregistré et chiffré. Laissez vide pour le conserver.' : undefined}
      >
        <Input
          type="password"
          autoComplete="new-password"
          placeholder={stored ? '••••••••' : undefined}
          {...props}
        />
      </Field>
    );
  };

  const ip = field('ipAddress');
  const host = field('hostname');
  const mac = field('macAddress');
  const snmpVersion = field('snmpVersion');
  const port = field('snmpPort');
  const user = field('snmpUsername');
  const securityLevel = field('snmpSecurityLevel');
  const authProtocol = field('snmpAuthProtocol');
  const privProtocol = field('snmpPrivProtocol');

  return (
    <form noValidate className="grid gap-5" onSubmit={handleSubmit(submit)}>
      <FormError message={formError} />
      {notice && !isDirty && (
        <p
          role="status"
          className="rounded-md border border-success/25 bg-success/10 px-3.5 py-2.5 text-[13px] text-success"
        >
          {notice}
        </p>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-3 text-[13px] font-semibold">Adresse réseau</legend>
        <Field id={ip.id} label="Adresse IP" error={ip.error} hint="IPv4 ou IPv6">
          <Input
            className="font-mono"
            spellCheck={false}
            placeholder="Ex. 192.168.1.20"
            {...ip.props}
          />
        </Field>
        <Field
          id={host.id}
          label="Nom d’hôte"
          error={host.error}
          hint="Si l’adresse est attribuée par DHCP"
        >
          <Input className="font-mono" spellCheck={false} {...host.props} />
        </Field>
        <Field id={mac.id} label="Adresse MAC" error={mac.error} hint="Facultatif">
          <Input
            className="font-mono"
            spellCheck={false}
            placeholder="Ex. 00:1B:44:11:3A:B7"
            {...mac.props}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 border-t border-border/80 pt-5 sm:grid-cols-3">
        <legend className="sr-only">SNMP</legend>
        <p className="text-[13px] font-semibold sm:col-span-3">Accès SNMP</p>
        <Field id={snmpVersion.id} label="Version" error={snmpVersion.error}>
          <Select {...snmpVersion.props}>
            {SNMP_VERSIONS.map((value) => (
              <option key={value} value={value}>
                {SNMP_VERSION_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={port.id} label="Port" error={port.error}>
          <Input type="number" inputMode="numeric" min={1} max={65535} {...port.props} />
        </Field>
        {!v3 &&
          secretField(
            'snmpCommunity',
            'Communauté (lecture)',
            Boolean(connection?.hasCommunity && sameVersion),
          )}
        {!v3 && (
          <p className="flex items-start gap-2 text-[13px] text-warning sm:col-span-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            En SNMPv1 et v2c, la communauté circule en clair sur le réseau. Préférez SNMPv3 si
            l’imprimante le permet.
          </p>
        )}
        {v3 && (
          <>
            <Field id={user.id} label="Utilisateur" error={user.error}>
              <Input autoComplete="off" {...user.props} />
            </Field>
            <Field id={securityLevel.id} label="Niveau de sécurité" error={securityLevel.error}>
              <Select {...securityLevel.props}>
                <option value="">Choisir…</option>
                {SNMP_SECURITY_LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {SNMP_SECURITY_LEVEL_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        {auth && (
          <>
            <Field id={authProtocol.id} label="Authentification" error={authProtocol.error}>
              <Select {...authProtocol.props}>
                <option value="">Choisir…</option>
                {SNMP_AUTH_PROTOCOLS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
            {secretField(
              'snmpAuthPassword',
              'Mot de passe d’authentification',
              Boolean(connection?.hasAuthPassword && sameVersion),
            )}
          </>
        )}
        {priv && (
          <>
            <Field id={privProtocol.id} label="Chiffrement" error={privProtocol.error}>
              <Select {...privProtocol.props}>
                <option value="">Choisir…</option>
                {SNMP_PRIV_PROTOCOLS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
            {secretField(
              'snmpPrivPassword',
              'Mot de passe de chiffrement',
              Boolean(connection?.hasPrivPassword && sameVersion),
            )}
          </>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-border/80 pt-5">
        {connection && (
          <Button type="button" variant="ghost" className="mr-auto text-danger" onClick={onClear}>
            Supprimer la configuration
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Enregistrement…' : 'Enregistrer la configuration'}
        </Button>
      </div>
    </form>
  );
}

import type { PrinterConnection } from '@arksen/shared-types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NetworkForm } from './network-form';

const stored: PrinterConnection = {
  ipAddress: '192.168.1.20',
  hostname: null,
  macAddress: null,
  snmpVersion: 'V2C',
  snmpPort: 161,
  hasCommunity: true,
  snmpUsername: null,
  snmpSecurityLevel: null,
  snmpAuthProtocol: null,
  hasAuthPassword: false,
  snmpPrivProtocol: null,
  hasPrivPassword: false,
  updatedAt: '2026-11-04T10:00:00.000Z',
};

function setup(connection: PrinterConnection | null) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<NetworkForm connection={connection} onSubmit={onSubmit} onClear={vi.fn()} />);
  return onSubmit;
}

const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la configuration' }));

describe('NetworkForm', () => {
  it('n’affiche jamais un secret enregistré et le conserve si le champ reste vide', async () => {
    const onSubmit = setup(stored);

    const community = screen.getByLabelText('Communauté (lecture)');
    expect(community).toHaveValue('');
    expect(
      screen.getByText('Enregistré et chiffré. Laissez vide pour le conserver.'),
    ).toBeInTheDocument();

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const sent = onSubmit.mock.calls[0]![0];
    expect(sent).toMatchObject({ ipAddress: '192.168.1.20', snmpVersion: 'V2C', snmpPort: 161 });
    expect(sent).not.toHaveProperty('snmpCommunity');
  });

  it('envoie la nouvelle communauté quand elle est saisie', async () => {
    const onSubmit = setup(stored);
    fireEvent.change(screen.getByLabelText('Communauté (lecture)'), {
      target: { value: 'lecture' },
    });

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0].snmpCommunity).toBe('lecture');
  });

  it('exige une adresse et demande les paramètres SNMPv3', async () => {
    const onSubmit = setup(null);
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: 'V3' } });

    expect(screen.queryByLabelText('Communauté (lecture)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Utilisateur')).toBeInTheDocument();

    submit();
    expect(
      await screen.findByText('Saisissez une adresse IP ou un nom d’hôte.'),
    ).toBeInTheDocument();
    expect(screen.getByText('SNMPv3 exige un nom d’utilisateur.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

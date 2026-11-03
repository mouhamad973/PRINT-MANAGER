import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from './login-form';

const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

function renderForm() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginForm />
    </QueryClientProvider>,
  );
}

function fillAndSubmit(email: string, password: string) {
  fireEvent.input(screen.getByLabelText('Adresse e-mail'), { target: { value: email } });
  fireEvent.input(screen.getByLabelText('Mot de passe'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
}

describe('LoginForm', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    replace.mockReset();
    fetchMock.mockReset();
    searchParams = new URLSearchParams();
    vi.stubGlobal('fetch', fetchMock);
    renderForm();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('valide la saisie avant tout appel au serveur', async () => {
    fillAndSubmit('pas-un-email', '');

    expect(await screen.findByText('Saisissez une adresse e-mail valide.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ne précise pas lequel de l’adresse ou du mot de passe est faux', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"message":"Invalid email or password"}', { status: 401 }),
    );
    fillAndSubmit('awa@exemple.sn', 'mauvais');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Adresse e-mail ou mot de passe incorrect.',
    );
  });

  it('signale le blocage après trop de tentatives', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    fillAndSubmit('awa@exemple.sn', 'mauvais');

    expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives');
  });

  it('redirige vers la page demandée, mais jamais vers un site externe', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    searchParams = new URLSearchParams({ next: '//site-malveillant.example' });
    cleanup();
    renderForm();
    fillAndSubmit('awa@exemple.sn', 'un-mot-de-passe-long');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/backend/api/auth/sign-in/email',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

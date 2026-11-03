import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type User, type UserRole } from '@arksen/database';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { PRISMA_SYSTEM } from '../database/database.module.js';
import { AUTH, type Auth } from './auth.js';

export interface NewAccount {
  name: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
  password: string;
}

/**
 * Opérations sur les identifiants : création de compte, réinitialisation, révocation.
 * Elles touchent les tables `accounts` et `sessions`, inaccessibles au rôle métier,
 * et passent donc par le client système.
 */
@Injectable()
export class AccountsService {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(PRISMA_SYSTEM) private readonly systemPrisma: PrismaClient,
  ) {}

  /** Crée l'utilisateur et son mot de passe dans une même transaction : jamais de compte sans identifiant. */
  async createCredentialUser(account: NewAccount): Promise<User> {
    const passwordHash = await this.hashPassword(account.password);
    const userId = randomUUID();
    try {
      return await this.systemPrisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: userId,
            name: account.name,
            email: account.email,
            emailVerified: true,
            role: account.role,
            tenantId: account.tenantId,
          },
        });
        await tx.account.create({
          data: {
            id: randomUUID(),
            userId,
            accountId: userId,
            providerId: 'credential',
            password: passwordHash,
          },
        });
        return user;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Cette adresse e-mail est déjà utilisée.');
      }
      throw error;
    }
  }

  /** Remplace le mot de passe et ferme toutes les sessions ouvertes du compte. */
  async resetPassword(userId: string, password: string): Promise<void> {
    const passwordHash = await this.hashPassword(password);
    await this.systemPrisma.$transaction([
      this.systemPrisma.account.updateMany({
        where: { userId, providerId: 'credential' },
        data: { password: passwordHash },
      }),
      this.systemPrisma.session.deleteMany({ where: { userId } }),
    ]);
  }

  async revokeSessions(userId: string): Promise<void> {
    await this.systemPrisma.session.deleteMany({ where: { userId } });
  }

  private async hashPassword(password: string): Promise<string> {
    const context = await this.auth.$context;
    return context.password.hash(password);
  }
}

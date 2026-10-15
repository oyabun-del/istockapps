import type { CreateTicketInput } from '@istock/shared';
import type { Ticket, User } from '../domain/models.js';
import { AppError } from '../lib/app-error.js';
import type { Repositories } from '../repositories/repositories.js';
import type { NotificationService } from './notification-service.js';
import { getOwnedOrder } from './order-access.js';

const TICKET_WINDOW_MS = 60 * 60 * 1000;
export const MAX_TICKETS_PER_WINDOW = 5;

export interface TicketServiceDeps {
  repos: Repositories;
  notifications: NotificationService;
  now?: () => Date;
}

export class TicketService {
  private readonly now: () => Date;

  constructor(private readonly deps: TicketServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async create(user: User, input: CreateTicketInput): Promise<Ticket> {
    const { repos } = this.deps;
    const orderId = input.orderId ?? null;
    if (orderId !== null) await getOwnedOrder(repos.orders, user.id, orderId);

    const since = new Date(this.now().getTime() - TICKET_WINDOW_MS);
    if ((await repos.tickets.countByUserSince(user.id, since)) >= MAX_TICKETS_PER_WINDOW) {
      throw new AppError('TOO_MANY_REQUESTS', 'Слишком много обращений. Напишите в поддержку напрямую.');
    }

    await repos.users.upsert(user);
    const ticket = await repos.tickets.create({ userId: user.id, orderId, message: input.message });
    await this.deps.notifications.ticketCreated(ticket, user);
    return ticket;
  }
}

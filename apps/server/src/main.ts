import { pino } from 'pino';
import { configureBot, createBot, createBotTelegram, registerBotHandlers } from './bot/bot.js';
import { createOfflineTelegram } from './bot/offline-telegram.js';
import { channelUrl, parseEnv, supportUrl } from './config/env.js';
import { createContainer } from './container.js';
import { buildApp } from './http/app.js';
import { getErrorMessage } from './lib/app-error.js';

const SECRET_PATHS = ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers["x-signature"]'];

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const logger = pino({
    level: env.LOG_LEVEL,
    redact: { paths: SECRET_PATHS, censor: '[redacted]' },
    transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  });

  // TELEGRAM_OFFLINE wins even when a token is set: the bot is neither created nor started.
  const bot = env.BOT_TOKEN && !env.TELEGRAM_OFFLINE ? createBot(env.BOT_TOKEN) : null;
  const telegram = bot ? createBotTelegram(bot) : createOfflineTelegram({ channel: env.REQUIRED_CHANNEL, logger });
  const container = createContainer(env, telegram, logger);
  if (bot) {
    registerBotHandlers(bot, {
      webAppUrl: env.WEBAPP_URL,
      channelUrl: channelUrl(env),
      supportUrl: supportUrl(env),
      users: container.repos.users,
      subscription: container.subscription,
      logger,
      adminIds: env.ADMIN_IDS,
      partnerAdmin: container.partnerAdmin,
      broadcasts: container.broadcasts,
      shopAdmin: container.shopAdmin,
      salesStats: container.salesStats,
    });
  }

  const app = await buildApp(container.appDeps, logger);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    await Promise.allSettled([container.background.stop(), bot?.stop(), app.close()]);
    await container.db.$disconnect();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: env.HOST });
  container.background.start();
  if (env.PAYMENT_PROVIDER === 'mock') logger.warn('PAYMENT_PROVIDER=mock: payments are simulated');

  if (!bot) {
    logger.warn(
      { devUserId: env.DEV_USER_ID },
      'TELEGRAM_OFFLINE: no bot, everyone is subscribed, messages go to this log. Open the Mini App in a regular browser.',
    );
    return;
  }

  await configureBot(bot, { webAppUrl: env.WEBAPP_URL, logger, adminIds: env.ADMIN_IDS });
  // Long polling; runs until bot.stop(). The HTTP API keeps working if the bot fails.
  bot
    .start({
      allowed_updates: ['message', 'callback_query'],
      onStart: (info) => logger.info({ bot: info.username }, 'Bot started'),
    })
    .catch((error: unknown) => logger.error({ err: getErrorMessage(error) }, 'Bot polling stopped'));
}

main().catch((error: unknown) => {
  // Logger may not exist yet (e.g. invalid env), so write straight to stderr.
  process.stderr.write(`Fatal: ${getErrorMessage(error)}\n`);
  process.exit(1);
});

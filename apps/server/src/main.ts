import { pino } from 'pino';
import { configureBot, createBot, registerBotHandlers } from './bot/bot.js';
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

  const bot = createBot(env.BOT_TOKEN);
  const container = createContainer(env, bot, logger);
  registerBotHandlers(bot, {
    webAppUrl: env.WEBAPP_URL,
    channelUrl: channelUrl(env),
    supportUrl: supportUrl(env),
    users: container.repos.users,
    subscription: container.subscription,
    logger,
  });

  const app = await buildApp(container.appDeps, logger);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    await Promise.allSettled([bot.stop(), app.close()]);
    await container.db.$disconnect();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: env.HOST });
  await configureBot(bot, { webAppUrl: env.WEBAPP_URL, logger });
  if (env.PAYMENT_PROVIDER === 'mock') logger.warn('PAYMENT_PROVIDER=mock: payments are simulated');

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

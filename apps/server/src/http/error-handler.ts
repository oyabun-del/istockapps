import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../lib/app-error.js';
import { fail } from './envelope.js';

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= HTTP_SERVER_ERROR_MIN) request.log.error({ err: error, cause: error.cause }, error.message);
      return reply.status(error.statusCode).send(fail(error.code, error.message));
    }

    const status = error.statusCode ?? HTTP_SERVER_ERROR_MIN;
    if (status === HTTP_TOO_MANY_REQUESTS) {
      return reply.status(status).send(fail('TOO_MANY_REQUESTS', 'Слишком много запросов, попробуйте позже'));
    }
    if (status >= HTTP_CLIENT_ERROR_MIN && status < HTTP_SERVER_ERROR_MIN) {
      return reply.status(status).send(fail('VALIDATION_ERROR', 'Некорректный запрос'));
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply.status(HTTP_SERVER_ERROR_MIN).send(fail('INTERNAL_ERROR', 'Внутренняя ошибка сервера'));
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send(fail('NOT_FOUND', 'Не найдено')));
}

import { HttpAuthService } from '@backstage/backend-plugin-api';
import { AuthenticationError, InputError } from '@backstage/errors';
import express from 'express';
import Router from 'express-promise-router';
import { ArgoCdService } from './service';

const NAME = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;
/** The person's Dex ID token. `Authorization` is taken by the Backstage token, so it travels in its own header. */
export const ID_TOKEN_HEADER = 'x-dex-id-token';

export async function createRouter(o: { httpAuth: HttpAuthService; service: ArgoCdService }): Promise<express.Router> {
  const router = Router();
  router.use(async (req, _res, next) => {
    await o.httpAuth.credentials(req, { allow: ['user'] });
    next();
  });

  const target = (req: express.Request) => {
    const name = String(req.params.name ?? '');
    if (!NAME.test(name)) throw new InputError('application must be a Kubernetes name');
    const token = req.header(ID_TOKEN_HEADER);
    if (!token) throw new AuthenticationError('Missing the Dex ID token of the signed-in person.');
    return { name, token };
  };

  /** GET /applications/:name : sync, health, revision, auto-sync policy, last operation and history. */
  router.get('/applications/:name', async (req, res) => {
    const { name, token } = target(req);
    res.json(await o.service.application(name, token));
  });

  /** GET /applications/:name/resources : the objects the Application owns, with their health. */
  router.get('/applications/:name/resources', async (req, res) => {
    const { name, token } = target(req);
    res.json({ resources: await o.service.resources(name, token) });
  });

  return router;
}

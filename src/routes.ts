import express from 'express';
import { Singleton } from 'typescript-ioc';
import { routes as auth } from './auth';
import { routes as gameServers } from './game-servers';
import { routes as games } from './games';
import { routes as players } from './players';
import { routes as profile } from './profile';
import { routes as queue } from './queue';

@Singleton
export class Routes {
  public setupRoutes(app: express.Application): void {
    app.use('/profile', profile);
    app.use('/queue', queue);
    app.use('/players', players);
    app.use('/games', games);
    app.use('/game-servers', gameServers);
    app.use('/auth', auth);
  }
}

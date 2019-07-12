import express from 'express';
import { routes as profile } from './profile';
import { routes as queue } from './queue';

export class Routes {
  public routes(app: express.Application): void {
    app.use('/profile', profile);
    app.use('/queue', queue);
  }
}

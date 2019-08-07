import { Response } from 'express';
import { inject, LazyServiceIdentifer, postConstruct } from 'inversify';
import { controller, httpGet, response } from 'inversify-express-utils';
import { lazyInject } from '../../container';
import { WsProviderService } from '../../core';
import logger from '../../logger';
import { QueueService } from '../services';

@controller('/queue')
export class QueueController {

  @lazyInject(QueueService) private queueService: QueueService;
  @lazyInject(WsProviderService) private wsProvider: WsProviderService;

  @httpGet('/')
  public async index(@response() res: Response) {
    return res.status(200).send({
      config: this.queueService.config,
      state: this.queueService.state,
      slots: this.queueService.slots,
      map: this.queueService.map,
    });
  }

  @httpGet('/config')
  public async getConfig(@response() res: Response) {
    return res.status(200).send(this.queueService.config);
  }

  @httpGet('/state')
  public async getStats(@response() res: Response) {
    return res.status(200).send(this.queueService.state);
  }

  @httpGet('/slots')
  public async getSlots(@response() res: Response) {
    return res.status(200).send(this.queueService.slots);
  }

  @httpGet('/map')
  public async getMap(@response() res: Response) {
    return res.status(200).send(this.queueService.map);
  }

  @postConstruct()
  public setupWs() {
    this.wsProvider.ws.on('connection', socket => {
      if (socket.request.user.logged_in) {
        const player = socket.request.user;

        socket.on('disconnect', () => {
          try {
            this.queueService.leave(player.id);
          } catch (error) { }
        });

        socket.on('join queue', async (slotId: number, done) => {
          try {
            const slot = await this.queueService.join(slotId, player.id, socket);
            done({ value: slot });
          } catch (error) {
            done({ error: error.message });
          }
        });

        socket.on('leave queue', done => {
          try {
            const slot = this.queueService.leave(player.id, socket);
            done({ value: slot });
          } catch (error) {
            done({ error: error.message });
          }
        });

        socket.on('player ready', async done => {
          try {
            const slot = await this.queueService.ready(player.id, socket);
            done({ value: slot });
          } catch (error) {
            done({ error: error.message });
          }
        });
      }
    });
    logger.debug('queue ws calls setup');
  }

}

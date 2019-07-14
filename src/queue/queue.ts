import { Inject } from 'typescript-ioc';
import { createGame } from '../games';
import { IoProvider } from '../io-provider';
import logger from '../logger';
import { QueueConfig } from './models/queue-config';
import { QueueSlot } from './models/queue-slot';
import { QueueState } from './models/queue-state';

const config6v6: QueueConfig = {
  teamCount: 2,
  classes: [
    { name: 'scout', count: 2 },
    { name: 'soldier', count: 2 },
    { name: 'demoman', count: 1 },
    { name: 'medic', count: 1 },
  ],
  readyUpTimeout: 60 * 1000, // 1 minute
};

const configTest: QueueConfig = {
  teamCount: 2,
  classes: [
    { name: 'soldier', count: 1 },
  ],
  readyUpTimeout: 10 * 1000, // 10 seconds
};

class Queue {

  public config: QueueConfig = configTest;
  public slots: QueueSlot[] = [];
  public state: QueueState = 'waiting';
  private timer: NodeJS.Timeout;
  @Inject private ioProvider: IoProvider;

  get requiredPlayerCount() {
    return this.config.classes.reduce((prev, curr) => prev + curr.count, 0) * this.config.teamCount;
  }

  get playerCount() {
    return this.slots.reduce((prev, curr) => curr.playerId ? prev + 1 : prev, 0);
  }

  get readyPlayerCount() {
    return this.slots.reduce((prev, curr) => curr.playerReady ? prev + 1 : prev, 0);
  }

  constructor() {
    this.resetSlots();
    this.setupIo();
  }

  /**
   * Clears all slots, resets the queue to default state.
   */
  public reset() {
    this.resetSlots();
    this.ioProvider.io.emit('queue slots reset', this.slots);
    this.updateState();
  }

  /**
   * Joins the given player at the given spot.
   * @param slotId The slot to be taken.
   * @param playerId The player to take the slot.
   */
  public join(slotId: number, playerId: string, sender?: SocketIO.Socket): QueueSlot {
    const slot = this.slots.find(s => s.id === slotId);
    if (!slot) {
      throw new Error('no such slot');
    }

    if (slot.playerId) {
      throw new Error('slot already taken');
    }

    this.slots.forEach(s => {
      if (s.playerId === playerId) {
        delete s.playerId;
        s.playerReady = false;
        this.slotUpdated(s);
      }
    });

    slot.playerId = playerId;
    if (this.state === 'ready') {
      slot.playerReady = true;
    }

    this.slotUpdated(slot, sender);
    setTimeout(() => this.updateState(), 0);
    return slot;
  }

  /**
   * Player leaves the queue.
   * @param playerId The player to leave.
   */
  public leave(playerId: string, sender?: SocketIO.Socket): QueueSlot {
    const slot = this.slots.find(s => s.playerId === playerId);
    if (slot) {
      if (this.state !== 'waiting' && slot.playerReady) {
        throw new Error('cannot unready when already readied up');
      }

      delete slot.playerId;
      this.slotUpdated(slot, sender);
      setTimeout(() => this.updateState(), 0);
      return slot;
    } else {
      return null;
    }
  }

  public ready(playerId: string, sender?: SocketIO.Socket): QueueSlot {
    if (this.state !== 'ready') {
      throw new Error('queue not ready');
    }

    const slot = this.slots.find(s => s.playerId === playerId);
    if (slot) {
      slot.playerReady = true;
      this.slotUpdated(slot, sender);
      setTimeout(() => this.updateState(), 0);
      return slot;
    } else {
      throw new Error('player is not in the queue');
    }
  }

  private resetSlots() {
    let lastId = 0;
    this.slots = this.config.classes.reduce((prev, curr) => {
      const tmpSlots = [];
      for (let i = 0; i < curr.count * this.config.teamCount; ++i) {
        tmpSlots.push({ id: lastId++, gameClass: curr.name, playerReady: false });
      }

      return prev.concat(tmpSlots);
    }, []);
  }

  private setupIo() {
    this.ioProvider.io.on('connection', socket => {
      if (socket.request.user.logged_in) {
        const player = socket.request.user;

        socket.on('disconnect', () => {
          try {
            queue.leave(player.id);
          } catch (error) { }
        });

        socket.on('join queue', (slotId: number, done) => {
          try {
            const slot = this.join(slotId, player.id, socket);
            done({ slot });
          } catch (error) {
            done({ error: error.message });
          }
        });

        socket.on('leave queue', done => {
          try {
            const slot = this.leave(player.id, socket);
            done({ slot });
          } catch (error) {
            done({ error: error.message });
          }
        });

        socket.on('player ready', done => {
          try {
            const slot = this.ready(player.id, socket);
            done({ slot });
          } catch (error) {
            done({ error: error.message });
          }
        });
      }
    });
  }

  private updateState() {
    switch (this.state) {
      case 'waiting':
        if (this.playerCount === this.requiredPlayerCount) {
          this.setState('ready');
        }
        break;

      case 'ready':
        if (this.playerCount === 0) {
          this.setState('waiting');
        } else if (this.readyPlayerCount === this.requiredPlayerCount) {
          this.setState('launching');
        }
        break;

      case 'launching':
        this.setState('waiting');
        break;
    }
  }

  private setState(state: QueueState) {
    if (state !== this.state) {
      this.onStateChange(this.state, state);
      this.state = state;
    }
  }

  private onStateChange(oldState: QueueState, newState: QueueState) {
    if (oldState === 'waiting' && newState === 'ready') {
      this.timer = setTimeout(() => this.readyUpTimeout(), this.config.readyUpTimeout);
    } else if (oldState === 'ready' && newState === 'launching') {
      delete this.timer;
      this.launch();
    } else if (oldState === 'launching' && newState === 'waiting') {
      delete this.timer;
    }

    this.ioProvider.io.emit('queue state update', newState);
  }

  private slotUpdated(slot: QueueSlot, sender?: SocketIO.Socket) {
    if (sender) {
      // broadcast event to everyone except the sender
      sender.broadcast.emit('queue slot update', slot);
    } else {
      this.ioProvider.io.emit('queue slot update', slot);
    }
  }

  private readyUpTimeout() {
    if (this.readyPlayerCount === this.requiredPlayerCount) {
      this.setState('launching');
    } else {
      this.slots.forEach(s => {
        s.playerReady = false;
        this.slotUpdated(s);
      });

      this.setState('waiting');
    }
  }

  private async launch() {
    const game = await createGame(this.config, this.slots);
    logger.info(`game ${game.id} created`);
    setTimeout(() => this.reset(), 0);
  }

}

export const queue = new Queue();

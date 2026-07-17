import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AdminActionPayload, EV, InputPayload } from '@holdout/shared';
import { verifyToken } from '../auth/jwt.util';
import { GameService } from './game.service';
import { RateLimiter } from './rate-limit';
import { corsOrigins } from '../config/cors';

@WebSocketGateway({
  cors: { origin: corsOrigins() },
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger('Gateway');

  // anti-cheat: per-socket budgets (docs/ANTICHEAT.md)
  private readonly inputLimit = new RateLimiter(40, 80);
  private readonly actionLimit = new RateLimiter(12, 24);
  private readonly tradeLimit = new RateLimiter(6, 12);
  private readonly heavyLimit = new RateLimiter(2, 4); // hideout transitions
  private readonly chatLimit = new RateLimiter(2, 5);
  private readonly adminLimit = new RateLimiter(5, 10);
  private violations = new Map<string, number>();

  @WebSocketServer()
  server: Server;

  constructor(private readonly game: GameService) {}

  afterInit(server: Server) {
    this.game.setServer(server);
    this.log.log('Socket.io gateway ready');
  }

  private allowed(socket: Socket, limiter: RateLimiter): boolean {
    if (limiter.allow(socket.id)) return true;
    const n = (this.violations.get(socket.id) ?? 0) + 1;
    this.violations.set(socket.id, n);
    if (n % 50 === 1) this.log.warn(`rate limit exceeded by ${socket.id} (${n} drops)`);
    return false;
  }

  async handleConnection(socket: Socket) {
    const token = socket.handshake.auth?.token as string | undefined;
    const claims = token ? verifyToken(token) : null;
    if (!claims) {
      socket.emit(EV.toast, 'Authentication failed');
      socket.disconnect(true);
      return;
    }
    try {
      const init = await this.game.addPlayer(socket.id, claims.sub, claims.username, claims.guest);
      socket.emit(EV.init, init);
    } catch (err) {
      this.log.error(`Join failed for ${claims.username}: ${(err as Error).message}`);
      await this.game.abandonPlayerAdmission(claims.sub, socket.id, claims.guest);
      socket.emit(
        EV.toast,
        (err as Error).message === 'PROFILE_LEASE_CONFLICT'
          ? 'This survivor is already active on another relay. Disconnect there or wait up to 45 seconds.'
          : (err as Error).message === 'WORLD_FULL'
            ? 'This relay is full. Choose another relay from deployment.'
          : (err as Error).message === 'PLAYER_BANNED'
            ? 'This survivor is currently suspended. Check the deployment screen for details.'
          : 'Failed to join world',
      );
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket) {
    this.violations.delete(socket.id);
    for (const l of [this.inputLimit, this.actionLimit, this.tradeLimit, this.heavyLimit, this.chatLimit, this.adminLimit]) l.clear(socket.id);
    await this.game.removePlayer(socket.id);
  }

  @SubscribeMessage(EV.input)
  onInput(@ConnectedSocket() socket: Socket, @MessageBody() body: InputPayload) {
    if (!this.allowed(socket, this.inputLimit)) return;
    this.game.setInput(socket.id, body ?? ({} as InputPayload));
  }

  @SubscribeMessage(EV.interact)
  onInteract(@ConnectedSocket() socket: Socket) {
    if (!this.allowed(socket, this.actionLimit)) return;
    this.game.interact(socket.id);
  }

  @SubscribeMessage(EV.containerTake)
  onContainerTake(@ConnectedSocket() socket: Socket, @MessageBody() body: { id: string; slot: number }) {
    if (!body || typeof body.id !== 'string' || !this.allowed(socket, this.actionLimit)) return;
    this.game.containerTake(socket.id, body.id, Number(body.slot) | 0);
  }

  @SubscribeMessage(EV.containerPut)
  onContainerPut(@ConnectedSocket() socket: Socket, @MessageBody() body: { id: string; slot: number; target?: number }) {
    if (!body || typeof body.id !== 'string' || !this.allowed(socket, this.actionLimit)) return;
    this.game.containerPut(socket.id, body.id, Number(body.slot) | 0, body.target === undefined ? -1 : Number(body.target) | 0);
  }

  @SubscribeMessage(EV.containerMove)
  onContainerMove(@ConnectedSocket() socket: Socket, @MessageBody() body: { id: string; from: number; to: number }) {
    if (!body || typeof body.id !== 'string' || !this.allowed(socket, this.actionLimit)) return;
    this.game.containerMove(socket.id, body.id, Number(body.from) | 0, Number(body.to) | 0);
  }

  @SubscribeMessage(EV.containerClose)
  onContainerClose(@ConnectedSocket() socket: Socket) {
    this.game.closeContainer(socket.id);
  }

  @SubscribeMessage(EV.invMove)
  onInvMove(@ConnectedSocket() socket: Socket, @MessageBody() body: { from: number; to: number }) {
    if (!body || !this.allowed(socket, this.actionLimit)) return;
    this.game.invMove(socket.id, Number(body.from) | 0, Number(body.to) | 0);
  }

  @SubscribeMessage(EV.invDrop)
  onInvDrop(@ConnectedSocket() socket: Socket, @MessageBody() body: { slot: number; qty?: number }) {
    if (!body || !this.allowed(socket, this.actionLimit)) return;
    this.game.invDrop(socket.id, Number(body.slot) | 0, Number(body.qty ?? 0));
  }

  @SubscribeMessage(EV.invUse)
  onInvUse(@ConnectedSocket() socket: Socket, @MessageBody() body: { slot: number }) {
    if (!body || !this.allowed(socket, this.actionLimit)) return;
    this.game.invUse(socket.id, Number(body.slot) | 0);
  }

  @SubscribeMessage(EV.invEquip)
  onInvEquip(@ConnectedSocket() socket: Socket, @MessageBody() body: { slot: number }) {
    if (!body || !this.allowed(socket, this.actionLimit)) return;
    this.game.invEquip(socket.id, Number(body.slot) | 0);
  }

  @SubscribeMessage(EV.unequipArmor)
  onUnequipArmor(@ConnectedSocket() socket: Socket, @MessageBody() body: { piece: 'helmet' | 'vest' | 'mod' }) {
    if (!body || !this.allowed(socket, this.actionLimit)) return;
    this.game.unequipArmor(socket.id, body.piece);
  }

  @SubscribeMessage(EV.reload)
  onReload(@ConnectedSocket() socket: Socket) {
    if (!this.allowed(socket, this.actionLimit)) return;
    this.game.reload(socket.id);
  }

  @SubscribeMessage(EV.build)
  onBuild(@ConnectedSocket() socket: Socket, @MessageBody() body: { slot: number; tx: number; ty: number; rotation?: number }) {
    if (!body || !this.allowed(socket, this.actionLimit)) return;
    this.game.build(socket.id, Number(body.slot) | 0, Number(body.tx) | 0, Number(body.ty) | 0, Number(body.rotation) | 0);
  }

  @SubscribeMessage(EV.demolish)
  onDemolish(@ConnectedSocket() socket: Socket, @MessageBody() body: { tx: number; ty: number }) {
    if (!body || !this.allowed(socket, this.actionLimit)) return;
    this.game.demolish(socket.id, Number(body.tx) | 0, Number(body.ty) | 0);
  }

  @SubscribeMessage(EV.repair)
  onRepair(@ConnectedSocket() socket: Socket, @MessageBody() body: { slot: number }) {
    if (!body || !this.allowed(socket, this.actionLimit)) return;
    this.game.repair(socket.id, Number(body.slot) | 0);
  }

  @SubscribeMessage(EV.look)
  onLook(@ConnectedSocket() socket: Socket, @MessageBody() body: { look: number }) {
    if (!body || !this.allowed(socket, this.actionLimit)) return;
    this.game.setLook(socket.id, Number(body.look) | 0);
  }

  @SubscribeMessage(EV.chat)
  onChat(@ConnectedSocket() socket: Socket, @MessageBody() body: { text: string }) {
    if (!body || typeof body.text !== 'string' || !this.allowed(socket, this.chatLimit)) return;
    this.game.chat(socket.id, body.text);
  }

  @SubscribeMessage(EV.questClaim)
  onQuestClaim(@ConnectedSocket() socket: Socket, @MessageBody() body: { id: number }) {
    if (!body || !this.allowed(socket, this.tradeLimit)) return;
    this.game.questClaim(socket.id, Number(body.id) | 0);
  }

  @SubscribeMessage(EV.stationFuel)
  onStationFuel(@ConnectedSocket() socket: Socket, @MessageBody() body: { index: number; qty?: number }) {
    if (!body || !this.allowed(socket, this.actionLimit)) return;
    this.game.addStationFuel(socket.id, Number(body.index) | 0, Number(body.qty ?? 1));
  }

  @SubscribeMessage(EV.craft)
  onCraft(@ConnectedSocket() socket: Socket, @MessageBody() body: { recipe: string }) {
    if (!body || typeof body.recipe !== 'string' || !this.allowed(socket, this.actionLimit)) return;
    this.game.craft(socket.id, body.recipe);
  }

  @SubscribeMessage(EV.respawn)
  onRespawn(@ConnectedSocket() socket: Socket) {
    if (!this.allowed(socket, this.actionLimit)) return;
    void this.game.respawn(socket.id);
  }

  @SubscribeMessage(EV.tradeBuy)
  onTradeBuy(@ConnectedSocket() socket: Socket, @MessageBody() body: { id: string; qty?: number }) {
    if (!body || typeof body.id !== 'string' || !this.allowed(socket, this.tradeLimit)) return;
    this.game.tradeBuy(socket.id, body.id, Number(body.qty ?? 1));
  }

  @SubscribeMessage(EV.tradeSell)
  onTradeSell(@ConnectedSocket() socket: Socket, @MessageBody() body: { slot: number; qty?: number }) {
    if (!body || !this.allowed(socket, this.tradeLimit)) return;
    this.game.tradeSell(socket.id, Number(body.slot) | 0, Number(body.qty ?? 0));
  }

  @SubscribeMessage(EV.hideoutEnter)
  async onHideoutEnter(@ConnectedSocket() socket: Socket, @MessageBody() body: { owner?: string } | undefined) {
    if (!this.allowed(socket, this.heavyLimit)) return;
    await this.game.enterHideout(socket.id, typeof body?.owner === 'string' ? body.owner : undefined);
  }

  @SubscribeMessage(EV.hideoutLeave)
  onHideoutLeave(@ConnectedSocket() socket: Socket) {
    if (!this.allowed(socket, this.heavyLimit)) return;
    this.game.leaveHideout(socket.id);
  }

  @SubscribeMessage(EV.clanHideoutEnter)
  async onClanHideoutEnter(@ConnectedSocket() socket: Socket) {
    if (!this.allowed(socket, this.heavyLimit)) return;
    await this.game.enterClanHideout(socket.id);
  }

  @SubscribeMessage(EV.clanTreasury)
  async onClanTreasury(@ConnectedSocket() socket: Socket, @MessageBody() body: { amount?: number } | undefined) {
    if (!body || !this.allowed(socket, this.tradeLimit)) return;
    await this.game.transferClanTreasury(socket.id, Number(body.amount));
  }

  @SubscribeMessage(EV.socialRefresh)
  async onClanRefresh(@ConnectedSocket() socket: Socket) {
    if (!this.allowed(socket, this.heavyLimit)) return;
    await this.game.refreshSocial(socket.id);
  }

  @SubscribeMessage(EV.adminRequest)
  async onAdminRequest(@ConnectedSocket() socket: Socket) {
    if (!this.allowed(socket, this.adminLimit)) return;
    await this.game.adminState(socket.id);
  }

  @SubscribeMessage(EV.adminAction)
  async onAdminAction(@ConnectedSocket() socket: Socket, @MessageBody() body: AdminActionPayload) {
    if (!body || typeof body !== 'object' || !this.allowed(socket, this.adminLimit)) return;
    await this.game.adminAction(socket.id, body);
  }
}

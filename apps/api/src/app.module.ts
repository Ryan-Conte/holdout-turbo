import { Module } from '@nestjs/common';
import { DbService } from './db/db.service';
import { GameService } from './game/game.service';
import { GameGateway } from './game/game.gateway';

@Module({
  providers: [DbService, GameService, GameGateway],
})
export class AppModule {}

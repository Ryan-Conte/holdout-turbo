import { Module } from '@nestjs/common';
import { DbService } from './db/db.service';
import { GameService } from './game/game.service';
import { GameGateway } from './game/game.gateway';
import { ContentService } from './game/content.service';
import { HealthController } from './health.controller';
import { TelemetryService } from './game/telemetry.service';

@Module({
  controllers: [HealthController],
  providers: [DbService, ContentService, TelemetryService, GameService, GameGateway],
})
export class AppModule {}

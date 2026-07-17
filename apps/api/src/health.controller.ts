import { Controller, Get } from '@nestjs/common';
import { TelemetryService } from './game/telemetry.service';
import { GameService } from './game/game.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly telemetry: TelemetryService,
    private readonly game: GameService,
  ) {}

  @Get()
  status() {
    return {
      status: 'ok',
      server: process.env.SERVER_NAME ?? 'HOLDOUT Game Server',
      region: process.env.SERVER_REGION ?? 'local',
      uptimeSeconds: Math.floor(process.uptime()),
      simulation: this.game.runtimeStats(),
      telemetry: this.telemetry.snapshot(),
    };
  }
}

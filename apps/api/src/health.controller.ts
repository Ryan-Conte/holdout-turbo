import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  status() {
    return {
      status: 'ok',
      server: process.env.SERVER_NAME ?? 'HOLDOUT Game Server',
      region: process.env.SERVER_REGION ?? 'local',
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}

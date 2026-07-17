import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });
loadEnv({ path: 'apps/api/.env', override: false });

const require = createRequire(import.meta.url);
const clientsArg = process.argv.find((argument) => argument.startsWith('--clients='));
const secondsArg = process.argv.find((argument) => argument.startsWith('--seconds='));
const clientCount = Math.max(1, Math.min(250, Number(clientsArg?.split('=')[1] ?? 100) | 0));
const durationSeconds = Math.max(3, Math.min(60, Number(secondsArg?.split('=')[1] ?? 10) | 0));
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const serverKey = `load-test:${suffix}`;

process.env.SERVER_STATE_KEY = serverKey;
process.env.PUBLIC_SERVER_URL = '';
process.env.RENDER_EXTERNAL_URL = '';
process.env.SERVER_NAME = 'HOLDOUT Load Test';
process.env.SERVER_REGION = 'benchmark';
process.env.MAX_PLAYERS_PER_SERVER = String(Math.max(200, clientCount));

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/app.module.js');
const { io } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();
const userIds = Array.from({ length: clientCount }, (_, index) => `load-${suffix}-${index}`);
const sockets = [];
let app;

const timeout = (milliseconds, label) => new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
  timer.unref?.();
});

try {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  await prisma.user.createMany({
    data: userIds.map((id, index) => ({ id, name: `Load${index}`, email: `${id}@holdout.local` })),
  });

  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  if (!port) throw new Error('Benchmark API did not bind a port');
  const url = `http://127.0.0.1:${port}`;
  const startedAt = performance.now();
  let stateCount = 0;
  let stateBytes = 0;
  let maxPopulation = 0;
  const lastStateAt = new Map();
  let largestStateGapMs = 0;

  const admissions = userIds.map((userId, index) => new Promise((resolve, reject) => {
    const token = jwt.sign({ sub: userId, username: `Load${index}` }, secret, { expiresIn: '5m' });
    const socket = io(url, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 30_000 });
    sockets.push(socket);
    let deployed = false;
    socket.on('connect_error', reject);
    socket.on('s:toast', (message) => {
      if (/failed|full|already active/i.test(String(message))) reject(new Error(String(message)));
    });
    socket.on('s:init', (init) => {
      if (init.kind === 'world') {
        if (!deployed) {
          deployed = true;
          resolve(undefined);
        }
      } else if (!deployed) socket.emit('c:hideout:leave');
    });
    socket.on('s:state', (state) => {
      const now = performance.now();
      const previous = lastStateAt.get(index);
      if (previous) largestStateGapMs = Math.max(largestStateGapMs, now - previous);
      lastStateAt.set(index, now);
      stateCount++;
      stateBytes += JSON.stringify(state).length;
      maxPopulation = Math.max(maxPopulation, Number(state.population) || 0);
    });
  }));

  await Promise.race([Promise.all(admissions), timeout(90_000, 'admission')]);
  const admittedMs = performance.now() - startedAt;
  // Admission includes map/init payload bursts. Measure the configured window
  // as steady-state world traffic so rates and gaps are operationally useful.
  stateCount = 0;
  stateBytes = 0;
  maxPopulation = 0;
  largestStateGapMs = 0;
  lastStateAt.clear();
  const inputTimer = setInterval(() => {
    sockets.forEach((socket, index) => {
      const phase = (Date.now() / 1000 + index) % 4;
      socket.emit('c:input', {
        up: phase < 1,
        right: phase >= 1 && phase < 2,
        down: phase >= 2 && phase < 3,
        left: phase >= 3,
        angle: (index * 0.618) % (Math.PI * 2),
        shoot: false,
        sprint: index % 3 === 0,
      });
    });
  }, 50);
  await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));
  clearInterval(inputTimer);

  const health = await fetch(`${url}/health`).then((response) => response.json());
  const statesPerClientSecond = stateCount / clientCount / durationSeconds;
  const averageStateBytes = stateCount ? Math.round(stateBytes / stateCount) : 0;
  const result = {
    clients: clientCount,
    durationSeconds,
    admittedMs: Math.round(admittedMs),
    statesPerClientSecond: Number(statesPerClientSecond.toFixed(2)),
    averageStateBytes,
    largestStateGapMs: Math.round(largestStateGapMs),
    maxPopulation,
    simulation: health.simulation,
  };
  console.log(JSON.stringify(result, null, 2));
  if (health.simulation?.players !== clientCount) throw new Error(`Expected ${clientCount} players, saw ${health.simulation?.players}`);
  if (maxPopulation < clientCount) throw new Error(`Population snapshots never reached ${clientCount}`);
  if (statesPerClientSecond < 8) throw new Error(`Snapshot rate fell below 8 Hz (${statesPerClientSecond.toFixed(2)})`);
} finally {
  for (const socket of sockets) socket.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (app) await app.close().catch(() => undefined);
  await prisma.playerWorldLease.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
  await prisma.profile.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  await prisma.gameWorldState.deleteMany({ where: { serverKey } }).catch(() => undefined);
  await prisma.$disconnect();
}

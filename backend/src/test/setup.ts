import { execSync } from 'child_process';
import { prisma } from '../db/client.js';

beforeAll(async () => {
  execSync('npx prisma migrate deploy', { stdio: 'pipe' });
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

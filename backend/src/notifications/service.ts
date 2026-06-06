import { PassThrough } from 'node:stream';
import { prisma } from '../db/client.js';

export type NotificationType = 'upload_complete' | 'new_asset' | 'new_version' | 'system';

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  resource_id: string | null;
  read: boolean;
  created_at: Date;
}

// Per-user set of active SSE streams
const sseClients = new Map<string, Set<PassThrough>>();

export function registerSseClient(userId: string, stream: PassThrough): () => void {
  let clients = sseClients.get(userId);
  if (!clients) {
    clients = new Set();
    sseClients.set(userId, clients);
  }
  clients.add(stream);

  return () => {
    const set = sseClients.get(userId);
    if (set) {
      set.delete(stream);
      if (set.size === 0) sseClients.delete(userId);
    }
  };
}

function pushToUser(userId: string, payload: object): void {
  const clients = sseClients.get(userId);
  if (!clients?.size) return;
  const event = `data: ${JSON.stringify(payload)}\n\n`;
  for (const stream of clients) {
    try {
      stream.write(event);
    } catch {
      // client may have already closed
    }
  }
}

export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  resourceId?: string | null;
}): Promise<void> {
  const n = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      resourceId: params.resourceId ?? null,
    },
    select: {
      id: true,
      userId: true,
      type: true,
      title: true,
      body: true,
      resourceId: true,
      read: true,
      createdAt: true,
    },
  });

  pushToUser(params.userId, {
    id: n.id,
    user_id: n.userId,
    type: n.type,
    title: n.title,
    body: n.body,
    resource_id: n.resourceId,
    read: n.read,
    created_at: n.createdAt,
  });
}

import { useEffect, useState } from 'react';
import { db } from './db.client';

export function useSyncManager() {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsOnline(true);
      processSyncQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check
    if (navigator.onLine) {
      processSyncQueue();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline, processSyncQueue };
}

export async function processSyncQueue() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  
  const queue = await db.syncQueue.toArray();
  if (queue.length === 0) return;

  for (const item of queue) {
    try {
      const res = await fetch(`/api/cards/${item.payload.subjectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload.body),
      });

      if (res.ok) {
        await db.syncQueue.delete(item.id!);
      }
    } catch (err) {
      console.error('Failed to sync item', item, err);
      // Stop processing queue if network fails during processing
      break; 
    }
  }
}

export async function queueSyncAction(action: 'review' | 'edit' | 'delete', subjectId: string, body: any) {
  await db.syncQueue.add({
    action,
    payload: { subjectId, body },
    created_at: new Date().toISOString()
  });
  
  // Try to process immediately if online
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    processSyncQueue();
  }
}

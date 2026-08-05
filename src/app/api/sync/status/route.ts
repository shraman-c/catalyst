import { NextRequest, NextResponse } from 'next/server';
import { getSession, ensureSchema } from '@/lib/auth';
import { queryOne, queryAll } from '@/lib/db';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureSchema();

  const { searchParams } = new URL(request.url);
  const subjectId = searchParams.get('subject_id');

  if (subjectId) {
    // Sync status for a specific subject
    const device = await queryOne<{
      id: string;
      name: string | null;
      folder_path: string | null;
      last_sync_at: string | null;
    }>(
      `SELECT id, name, folder_path, last_sync_at
       FROM devices
       WHERE user_id = ? AND subject_id = ? AND token IS NOT NULL
       ORDER BY last_sync_at DESC LIMIT 1`,
      [session.id, subjectId]
    );

    const noteCount = await queryOne<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM note_files WHERE subject_id = ?',
      [subjectId]
    );

    return NextResponse.json({
      subject_id: subjectId,
      watcher_connected: !!device,
      watcher_name: device?.name ?? null,
      folder_path: device?.folder_path ?? null,
      last_sync_at: device?.last_sync_at ?? null,
      note_count: noteCount?.cnt ?? 0,
    });
  }

  // All devices for this user with sync status
  const devices = await queryAll<{
    id: string;
    name: string | null;
    folder_path: string | null;
    subject_id: string | null;
    last_sync_at: string | null;
  }>(
    `SELECT id, name, folder_path, subject_id, last_sync_at
     FROM devices WHERE user_id = ? AND token IS NOT NULL
     ORDER BY last_sync_at DESC`,
    [session.id]
  );

  return NextResponse.json({ devices });
}

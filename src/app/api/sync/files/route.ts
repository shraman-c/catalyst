import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/auth';
import { queryOne, execute, generateId } from '@/lib/db';
import { processNote, hashContent } from '@/lib/ai/pipeline';
import { parseBody, syncFileSchema, syncDeleteSchema } from '@/lib/validation';
import { encryptNote } from '@/lib/encryption';
import { jwtVerify } from 'jose';

const jwtSecretStr = process.env.JWT_SECRET;
if (!jwtSecretStr) {
  throw new Error(
    'JWT_SECRET environment variable is required for device authentication. Add it to .env.local'
  );
}
const JWT_SECRET = new TextEncoder().encode(jwtSecretStr);

interface Device {
  id: string;
  user_id: string;
  subject_id: string | null;
  folder_path: string | null;
}

/** Authenticate via Bearer device token in Authorization header */
async function authenticateDevice(request: NextRequest): Promise<Device | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const deviceId = payload.device_id as string;

    const device = await queryOne<Device>(
      'SELECT id, user_id, subject_id, folder_path FROM devices WHERE id = ? AND token = ?',
      [deviceId, token]
    );
    return device;
  } catch {
    return null;
  }
}

/**
 * POST /api/sync/files
 * Receives a synced file from the watcher.
 * Body: { path: string, filename: string, content: string, hash: string, subject_id?: string }
 */
export async function POST(request: NextRequest) {
  await ensureSchema();

  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'Unauthorized — invalid device token' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = parseBody(syncFileSchema, body);
  if (!parsed.ok) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const { path: filePath, filename, content, hash, subject_id: bodySubjectId } = parsed.data;

  // Determine subject: prefer body override, fall back to device default
  const subjectId = bodySubjectId || device.subject_id;

  if (!subjectId) {
    return NextResponse.json({ error: 'No subject_id — configure a folder→subject mapping in the dashboard' }, { status: 400 });
  }
  if (!content?.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  // Audit 3.3: content inspection — reject binary payloads regardless of extension.
  if (content.includes('\u0000')) {
    return NextResponse.json({ error: 'File appears to be binary. Only text notes are supported.' }, { status: 400 });
  }

  const effectiveFilename = filename || (filePath ? filePath.split(/[\\/]/).pop() : 'synced-note.md');
  const contentHash = hash || (await hashContent(content));

  // Check for duplicate (unchanged content)
  const existing = await queryOne<{ id: string; content_hash: string }>(
    'SELECT id, content_hash FROM note_files WHERE subject_id = ? AND filename = ?',
    [subjectId, effectiveFilename]
  );

  if (existing?.content_hash === contentHash) {
    // Update device last_sync_at even if content unchanged
    await execute('UPDATE devices SET last_sync_at = NOW() WHERE id = ?', [device.id]);
    return NextResponse.json({ message: 'Content unchanged — skipped', reprocessed: false });
  }

  // Upsert note file
  let noteFileId: string;
  const isNewFile = !existing;
  const previousHash = existing?.content_hash ?? null;
  if (existing) {
    await execute(
      "UPDATE note_files SET content_hash = ?, source = 'watcher', updated_at = NOW() WHERE id = ?",
      [contentHash, existing.id]
    );
    noteFileId = existing.id;
  } else {
    noteFileId = generateId();
    await execute(
      "INSERT INTO note_files (id, subject_id, filename, content_hash, source, created_at, updated_at) VALUES (?, ?, ?, ?, 'watcher', NOW(), NOW())",
      [noteFileId, subjectId, effectiveFilename, contentHash]
    );
  }

  // Store version — encrypted at rest (fix 3.3); the pipeline still receives
  // the plaintext `content` in memory.
  const versionId = generateId();
  await execute(
    'INSERT INTO note_versions (id, note_file_id, content, created_at) VALUES (?, ?, ?, NOW())',
    [versionId, noteFileId, encryptNote(content)]
  );

  // Update device sync timestamp
  await execute('UPDATE devices SET last_sync_at = NOW() WHERE id = ?', [device.id]);

  // Run AI pipeline
  try {
    const pipelineResult = await processNote(noteFileId, subjectId, content, contentHash);
    return NextResponse.json({ success: true, note_file_id: noteFileId, reprocessed: true, pipeline: pipelineResult });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sync] Pipeline error:', message);

    // Roll back the note-file change so the watcher's next sync retries processing.
    if (isNewFile) {
      await execute('DELETE FROM note_files WHERE id = ?', [noteFileId]);
    } else if (previousHash) {
      await execute(
        'UPDATE note_files SET content_hash = ?, updated_at = NOW() WHERE id = ?',
        [previousHash, noteFileId]
      );
    }

    return NextResponse.json(
      { error: 'AI_PROCESSING_FAILED', detail: message, note_file_id: noteFileId },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/sync/files
 * Soft-deletes a synced file (marks it deleted in DB, keeps graph/cards).
 * Body: { path: string, filename: string, subject_id?: string }
 */
export async function DELETE(request: NextRequest) {
  await ensureSchema();

  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'Unauthorized — invalid device token' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = parseBody(syncDeleteSchema, body);
  if (!parsed.ok) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const { filename, subject_id: bodySubjectId } = parsed.data;
  const subjectId = bodySubjectId || device.subject_id;

  if (!subjectId || !filename) {
    return NextResponse.json({ error: 'filename and subject_id are required' }, { status: 400 });
  }

  // We do NOT delete graph nodes or cards — per AppFlow §7:
  // "concepts may be referenced elsewhere" — keep derived content, just mark the file.
  await execute(
    "UPDATE note_files SET updated_at = NOW(), source = 'watcher-deleted' WHERE subject_id = ? AND filename = ?",
    [subjectId, filename]
  );

  await execute('UPDATE devices SET last_sync_at = NOW() WHERE id = ?', [device.id]);

  return NextResponse.json({ success: true, message: 'Note soft-deleted; graph and cards preserved' });
}

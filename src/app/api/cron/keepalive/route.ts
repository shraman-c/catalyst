import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';

// This route can be triggered by Vercel Cron, GitHub Actions, or cron-job.org
// It executes a lightweight query to keep the Postgres instance active.
export async function GET(request: Request) {
  try {
    // Optional: Protect this route if you are using Vercel Cron
    const authHeader = request.headers.get('authorization');
    if (
      process.env.CRON_SECRET &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ping the database
    const ok = await execute('SELECT 1 as ping', []);

    if (ok) {
      return NextResponse.json({ success: true, message: 'Database pinged successfully' });
    } else {
      return NextResponse.json({ success: false, error: 'Database ping failed' }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Keepalive error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

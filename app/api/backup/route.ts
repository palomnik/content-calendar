// Download a SQL dump of the active database. Administrators only — the file
// contains every user's password hash and encrypted AI provider key.

import { NextRequest } from "next/server";
import { requireAdmin } from "../../lib/auth";
import { generateSqlBackup, readConfig } from "../../lib/db";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `content_calendar_backup_${stamp}.sql`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of generateSqlBackup()) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (e: any) {
        // Headers are long gone by the time a read fails, so the only honest
        // signal left is a comment in the file itself. A truncated dump that
        // looks complete would be far worse.
        controller.enqueue(
          encoder.encode(
            `\n-- BACKUP FAILED PART WAY THROUGH: ${String(e?.message ?? e).replace(/\r?\n/g, " ")}\n` +
              `-- This file is incomplete. Do not restore from it.\n`
          )
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/sql; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Backup-Provider": readConfig().provider,
    },
  });
}

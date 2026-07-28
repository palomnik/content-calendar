// Restore the database from a backup file. Administrators only, and the most
// destructive operation in the app: it deletes every content item, account, and
// AI connection before writing the backup's contents in their place.
//
// Two-step by design — POST { inspect: true } reports what a file contains
// without touching anything, mirroring the `test: true` flag on /api/config.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../lib/auth";
import { readConfig, restoreSqlBackup } from "../../lib/db";
import { BackupParseError, parseSqlBackup } from "../../lib/backup";

/** Refuse anything implausible before parsing megabytes of it. */
const MAX_BYTES = 100 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const body = await req.json();
    const sql = typeof body?.sql === "string" ? body.sql : "";
    if (!sql.trim()) {
      return NextResponse.json({ error: "No backup file was provided." }, { status: 400 });
    }
    if (sql.length > MAX_BYTES) {
      return NextResponse.json(
        { error: "That file is larger than 100 MB. Restore it with your database's command-line tool instead." },
        { status: 413 }
      );
    }

    const parsed = parseSqlBackup(sql);

    // A backup whose users table has no administrator would leave the app with
    // accounts that exist but nobody able to manage them — an unrecoverable
    // state short of editing the database by hand. An empty users table is
    // fine: that puts the app back into first-run setup.
    const users = parsed.tables.users ?? [];
    if (users.length > 0 && !users.some((u) => u.role === "admin")) {
      return NextResponse.json(
        {
          error:
            "That backup contains user accounts but no administrator. Restoring it would leave nobody able to manage the app, so it has been refused.",
        },
        { status: 400 }
      );
    }

    const summary = {
      sourceProvider: parsed.sourceProvider,
      generatedAt: parsed.generatedAt,
      counts: parsed.counts,
      warnings: parsed.warnings,
      targetProvider: readConfig().provider,
      admins: users.filter((u) => u.role === "admin").length,
    };

    if (body?.inspect) {
      return NextResponse.json({ ok: true, ...summary });
    }

    const result = await restoreSqlBackup(parsed);

    return NextResponse.json({
      ok: true,
      ...summary,
      inserted: result.inserted,
      total: result.total,
    });
  } catch (e: any) {
    if (e instanceof BackupParseError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: e?.message ?? "The restore failed." },
      { status: 500 }
    );
  }
}

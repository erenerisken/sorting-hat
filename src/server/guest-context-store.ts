import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type GuestContext = {
  fullName: string;
  tableNumber: string;
  context: string;
  updatedAt: string;
};

export class GuestContextStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    const absolutePath = path.resolve(process.cwd(), databasePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    this.database = new Database(absolutePath);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS guest_contexts (
        full_name TEXT NOT NULL,
        table_number TEXT NOT NULL,
        context TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (full_name, table_number)
      )
    `);
  }

  get(fullName: string, tableNumber: string): GuestContext | null {
    const row = this.database.prepare(`
      SELECT full_name AS fullName, table_number AS tableNumber, context, updated_at AS updatedAt
      FROM guest_contexts
      WHERE full_name = ? AND table_number = ?
    `).get(fullName, tableNumber) as GuestContext | undefined;
    return row ?? null;
  }

  list(): GuestContext[] {
    return this.database.prepare(`
      SELECT full_name AS fullName, table_number AS tableNumber, context, updated_at AS updatedAt
      FROM guest_contexts
    `).all() as GuestContext[];
  }

  set(fullName: string, tableNumber: string, context: string): GuestContext | null {
    if (!context) {
      this.database.prepare(`
        DELETE FROM guest_contexts WHERE full_name = ? AND table_number = ?
      `).run(fullName, tableNumber);
      return null;
    }

    const updatedAt = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO guest_contexts (full_name, table_number, context, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(full_name, table_number) DO UPDATE SET
        context = excluded.context,
        updated_at = excluded.updated_at
    `).run(fullName, tableNumber, context, updatedAt);
    return { fullName, tableNumber, context, updatedAt };
  }
}

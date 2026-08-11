import Database from "better-sqlite3";
import { parse } from "csv-parse/sync";
import { fuzzy } from "fast-fuzzy";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type Guest = {
  firstName: string;
  lastName: string;
  fullName: string;
  tableNumber: string;
  aliases: string[];
  context: string;
  contextUpdatedAt: string | null;
};

type GuestRow = {
  fullName: string;
  tableNumber: string;
  aliasesJson: string;
  context: string | null;
  contextUpdatedAt: string | null;
};

type ImportGuest = {
  fullName: string;
  tableNumber: string;
  aliases: string[];
};

export type ImportResult = {
  receivedRows: number;
  uniqueGuests: number;
  inserted: number;
  updated: number;
  unchanged: number;
};

export class GuestImportError extends Error {
  constructor(message: string, readonly row?: number) {
    super(message);
    this.name = "GuestImportError";
  }
}

type GuestMatch = {
  guest: Guest;
  score: number;
};

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAliases(value: string): string[] {
  return value.split(";").map((alias) => alias.trim()).filter(Boolean);
}

function guestFromRow(row: GuestRow): Guest {
  const nameParts = row.fullName.split(/\s+/);
  const lastName = nameParts.length > 1 ? nameParts.pop()! : "";
  return {
    firstName: nameParts.join(" ") || row.fullName,
    lastName,
    fullName: row.fullName,
    tableNumber: row.tableNumber,
    aliases: JSON.parse(row.aliasesJson) as string[],
    context: row.context ?? "",
    contextUpdatedAt: row.contextUpdatedAt
  };
}

export class GuestStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    const absolutePath = path.resolve(process.cwd(), databasePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    this.database = new Database(absolutePath);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS guests (
        full_name TEXT PRIMARY KEY,
        table_number TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        context TEXT,
        context_updated_at TEXT
      )
    `);
  }

  close(): void {
    this.database.close();
  }

  list(): Guest[] {
    const rows = this.database.prepare(`
      SELECT full_name AS fullName, table_number AS tableNumber, aliases AS aliasesJson,
             context, context_updated_at AS contextUpdatedAt
      FROM guests
      ORDER BY full_name COLLATE NOCASE
    `).all() as GuestRow[];
    return rows.map(guestFromRow);
  }

  get(fullName: string, tableNumber: string): Guest | null {
    const row = this.database.prepare(`
      SELECT full_name AS fullName, table_number AS tableNumber, aliases AS aliasesJson,
             context, context_updated_at AS contextUpdatedAt
      FROM guests
      WHERE full_name = ? AND table_number = ?
    `).get(fullName, tableNumber) as GuestRow | undefined;
    return row ? guestFromRow(row) : null;
  }

  setContext(fullName: string, tableNumber: string, context: string): Guest | null {
    const contextValue = context || null;
    const updatedAt = contextValue ? new Date().toISOString() : null;
    const result = this.database.prepare(`
      UPDATE guests
      SET context = ?, context_updated_at = ?
      WHERE full_name = ? AND table_number = ?
    `).run(contextValue, updatedAt, fullName, tableNumber);
    if (result.changes === 0) return null;
    return this.get(fullName, tableNumber);
  }

  importCsv(content: string): ImportResult {
    let records: Array<Record<string, string>>;
    try {
      records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true
      }) as Array<Record<string, string>>;
    } catch (error) {
      throw new GuestImportError(error instanceof Error ? `CSV okunamadı: ${error.message}` : "CSV okunamadı.");
    }

    if (records.length === 0) throw new GuestImportError("CSV en az bir davetli içermelidir.");
    const headers = Object.keys(records[0]);
    if (!headers.includes("fullName") || !headers.includes("tableNumber")) {
      throw new GuestImportError("CSV, fullName ve tableNumber sütunlarını içermelidir.");
    }

    const uniqueGuests = new Map<string, ImportGuest>();
    records.forEach((record, index) => {
      const row = index + 2;
      const fullName = record.fullName?.trim() ?? "";
      const tableNumber = record.tableNumber?.trim() ?? "";
      if (!fullName || !tableNumber) {
        throw new GuestImportError("fullName ve tableNumber boş olamaz.", row);
      }
      const guest = { fullName, tableNumber, aliases: parseAliases(record.aliases ?? "") };
      const previous = uniqueGuests.get(fullName);
      if (previous && (previous.tableNumber !== guest.tableNumber || JSON.stringify(previous.aliases) !== JSON.stringify(guest.aliases))) {
        throw new GuestImportError(`Aynı fullName için çelişen kayıtlar var: ${fullName}`, row);
      }
      uniqueGuests.set(fullName, guest);
    });

    const select = this.database.prepare("SELECT table_number AS tableNumber, aliases AS aliasesJson FROM guests WHERE full_name = ?");
    const insert = this.database.prepare("INSERT INTO guests (full_name, table_number, aliases) VALUES (?, ?, ?)");
    const update = this.database.prepare("UPDATE guests SET table_number = ?, aliases = ? WHERE full_name = ?");
    const importTransaction = this.database.transaction((guests: ImportGuest[]) => {
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      for (const guest of guests) {
        const aliasesJson = JSON.stringify(guest.aliases);
        const existing = select.get(guest.fullName) as { tableNumber: string; aliasesJson: string } | undefined;
        if (!existing) {
          insert.run(guest.fullName, guest.tableNumber, aliasesJson);
          inserted += 1;
        } else if (existing.tableNumber !== guest.tableNumber || existing.aliasesJson !== aliasesJson) {
          update.run(guest.tableNumber, aliasesJson, guest.fullName);
          updated += 1;
        } else {
          unchanged += 1;
        }
      }
      return { inserted, updated, unchanged };
    });
    const counts = importTransaction([...uniqueGuests.values()]);
    return { receivedRows: records.length, uniqueGuests: uniqueGuests.size, ...counts };
  }

  find(spokenName: string): {
    status: "found" | "ambiguous" | "not_found";
    spokenName: string;
    best?: GuestMatch;
    candidates: GuestMatch[];
  } {
    const query = normalize(spokenName);
    if (!query) return { status: "not_found", spokenName, candidates: [] };
    const candidates = this.list()
      .map((guest) => {
        const names = [guest.fullName, ...guest.aliases].map(normalize);
        return { guest, score: Math.max(...names.map((name) => fuzzy(query, name))) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const best = candidates[0];
    const second = candidates[1];
    if (!best || best.score < 0.68) return { status: "not_found", spokenName, candidates };
    if (second && best.score - second.score < 0.08) return { status: "ambiguous", spokenName, best, candidates };
    return { status: "found", spokenName, best, candidates };
  }
}

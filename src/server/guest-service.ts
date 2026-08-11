import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { fuzzy } from "fast-fuzzy";

export type Guest = {
  firstName: string;
  lastName: string;
  fullName: string;
  tableNumber: string;
  aliases: string[];
};

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

export class GuestService {
  private guests: Guest[] = [];

  constructor(private readonly csvPath: string) {}

  async load(): Promise<void> {
    const absolutePath = path.resolve(process.cwd(), this.csvPath);
    const content = await readFile(absolutePath, "utf8");
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    }) as Array<Record<string, string>>;

    this.guests = records.map((record) => {
      const explicitFullName = record.fullName?.trim();
      const legacyFirstName = record.firstName?.trim();
      const legacyLastName = record.lastName?.trim();
      const fullName = explicitFullName ?? [legacyFirstName, legacyLastName].filter(Boolean).join(" ");
      const tableNumber = record.tableNumber?.trim();
      if (!fullName || !tableNumber) {
        throw new Error("CSV satırında fullName veya tableNumber eksik.");
      }
      const nameParts = fullName.split(/\s+/);
      const lastName = nameParts.length > 1 ? nameParts.pop()! : "";
      const firstName = nameParts.join(" ") || fullName;
      return {
        firstName,
        lastName,
        fullName,
        tableNumber,
        aliases: (record.aliases ?? "")
          .split(";")
          .map((item) => item.trim())
          .filter(Boolean)
      };
    });
  }

  list(): Guest[] {
    return this.guests;
  }

  find(spokenName: string): {
    status: "found" | "ambiguous" | "not_found";
    spokenName: string;
    best?: GuestMatch;
    candidates: GuestMatch[];
  } {
    const query = normalize(spokenName);
    if (!query) return { status: "not_found", spokenName, candidates: [] };

    const candidates = this.guests
      .map((guest) => {
        const names = [guest.fullName, ...guest.aliases].map(normalize);
        const score = Math.max(...names.map((name) => fuzzy(query, name)));
        return { guest, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const best = candidates[0];
    const second = candidates[1];
    if (!best || best.score < 0.68) {
      return { status: "not_found", spokenName, candidates };
    }
    if (second && best.score - second.score < 0.08) {
      return { status: "ambiguous", spokenName, best, candidates };
    }
    return { status: "found", spokenName, best, candidates };
  }
}

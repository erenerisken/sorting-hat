import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { GuestImportError, GuestStore } from "./guest-store.js";

function withStore(run: (store: GuestStore) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), "sorting-hat-guests-"));
  const store = new GuestStore(path.join(directory, "guests.sqlite"));
  try {
    run(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("imports guests and collapses identical duplicate rows", () => {
  withStore((store) => {
    const result = store.importCsv("\uFEFFfullName,tableNumber,aliases\nAyşe Yılmaz,3,Ayşe;Ayşe Hanım\nAyşe Yılmaz,3,Ayşe;Ayşe Hanım\n");
    assert.deepEqual(result, { receivedRows: 2, uniqueGuests: 1, inserted: 1, updated: 0, unchanged: 0 });
    assert.deepEqual(store.list()[0].aliases, ["Ayşe", "Ayşe Hanım"]);
  });
});

test("rejects invalid and conflicting CSV without changing the database", () => {
  withStore((store) => {
    store.importCsv("fullName,tableNumber,aliases\nAyşe Yılmaz,3,\n");
    assert.throws(
      () => store.importCsv("fullName,tableNumber,aliases\nMehmet Kaya,4,\nMehmet Kaya,5,\n"),
      (error) => error instanceof GuestImportError && error.row === 3
    );
    assert.throws(
      () => store.importCsv("fullName,tableNumber,aliases\nEksik Masa,,\n"),
      (error) => error instanceof GuestImportError && error.row === 2
    );
    assert.deepEqual(store.list().map((guest) => guest.fullName), ["Ayşe Yılmaz"]);
  });
});

test("upserts mappings, preserves context, and does not delete absent guests", () => {
  withStore((store) => {
    store.importCsv("fullName,tableNumber,aliases\nAyşe Yılmaz,3,Ayşe\nMehmet Kaya,4,\n");
    assert.equal(store.setContext("Ayşe Yılmaz", "3", "Gelinin arkadaşı")?.context, "Gelinin arkadaşı");

    const result = store.importCsv("fullName,tableNumber,aliases\nAyşe Yılmaz,8,Ayşecik\n");
    assert.deepEqual(result, { receivedRows: 1, uniqueGuests: 1, inserted: 0, updated: 1, unchanged: 0 });
    assert.equal(store.get("Ayşe Yılmaz", "8")?.context, "Gelinin arkadaşı");
    assert.ok(store.get("Mehmet Kaya", "4"));

    const cleared = store.setContext("Ayşe Yılmaz", "8", "");
    assert.equal(cleared?.context, "");
    assert.equal(cleared?.contextUpdatedAt, null);
  });
});

test("finds guests through aliases", () => {
  withStore((store) => {
    store.importCsv("fullName,tableNumber,aliases\nAyşe Yılmaz,3,Ayşecik\nMehmet Kaya,4,\n");
    const result = store.find("Ayşecik");
    assert.equal(result.status, "found");
    assert.equal(result.best?.guest.fullName, "Ayşe Yılmaz");
  });
});

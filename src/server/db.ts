import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { foldForSearch, haversineKm } from "./search.ts";
import type { BBox } from "./validate.ts";
import type { Violation } from "./violations.ts";

export interface EstablishmentRow {
  /** The state's NYS Health operation id for the establishment. */
  id: string;
  name: string;
  address: string;
  city: string | null;
  zip: string | null;
  county: string | null;
  description: string | null;
  inspection_date: string | null;
  critical_count: number;
  noncritical_count: number;
  crit_not_corrected: number;
  comments: string | null;
  lat: number;
  lng: number;
}

export interface PointItem {
  id: string;
  name: string;
  lat: number;
  lng: number;
  critical: number;
  noncritical: number;
}

export interface ClusterItem {
  count: number;
  /** Set only when the cell holds a single establishment, so the client can draw it as a point. */
  id: string | null;
  name: string | null;
  critical: number;
  noncritical: number;
  lat: number;
  lng: number;
  west: number;
  south: number;
  east: number;
  north: number;
  withCritical: number;
}

export interface SearchResult {
  id: string;
  name: string;
  address: string;
  city: string | null;
  lat: number;
  lng: number;
  critical: number;
  noncritical: number;
  /** Kilometres from the reference point, when one was given. */
  distanceKm: number | null;
}

export interface NewEstablishment extends EstablishmentRow {
  violations: Violation[];
}

const MIGRATIONS: string[] = [
  `CREATE TABLE establishments (
     id TEXT PRIMARY KEY, -- nys_health_operation_id
     name TEXT NOT NULL,
     search_name TEXT NOT NULL, -- name folded by foldForSearch()
     address TEXT NOT NULL,
     city TEXT,
     zip TEXT,
     county TEXT,
     description TEXT,
     inspection_date TEXT,
     critical_count INTEGER NOT NULL DEFAULT 0,
     noncritical_count INTEGER NOT NULL DEFAULT 0,
     crit_not_corrected INTEGER NOT NULL DEFAULT 0,
     comments TEXT,
     lat REAL NOT NULL,
     lng REAL NOT NULL
   ) STRICT;
   CREATE INDEX establishments_lat_lng ON establishments(lat, lng);
   CREATE TABLE violations (
     establishment_id TEXT NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL,
     code TEXT,
     is_critical INTEGER NOT NULL,
     description TEXT NOT NULL,
     PRIMARY KEY (establishment_id, seq)
   ) STRICT;
   CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;`,
];

export class Store {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private migrate(): void {
    const { user_version } = this.db.query("PRAGMA user_version").get() as { user_version: number };
    for (let v = user_version; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      })();
    }
  }

  close(): void {
    this.db.close();
  }

  count(): number {
    return (this.db.query("SELECT count(*) AS n FROM establishments").get() as { n: number }).n;
  }

  countInBox(b: BBox): number {
    return (
      this.db
        .query("SELECT count(*) AS n FROM establishments WHERE lat BETWEEN $south AND $north AND lng BETWEEN $west AND $east")
        .get({ ...b }) as { n: number }
    ).n;
  }

  pointsInBox(b: BBox, limit: number): PointItem[] {
    return this.db
      .query(
        `SELECT id, name, lat, lng, critical_count AS critical, noncritical_count AS noncritical
         FROM establishments
         WHERE lat BETWEEN $south AND $north AND lng BETWEEN $west AND $east
         LIMIT $limit`,
      )
      .all({ ...b, limit }) as PointItem[];
  }

  /** Aggregate the rows in `b` into a grid of square cells `cell` degrees wide. */
  clustersInBox(b: BBox, cell: number): ClusterItem[] {
    return this.db
      .query(
        `SELECT count(*) AS count,
                CASE WHEN count(*) = 1 THEN min(id) END AS id,
                CASE WHEN count(*) = 1 THEN min(name) END AS name,
                sum(critical_count) AS critical, sum(noncritical_count) AS noncritical,
                avg(lat) AS lat, avg(lng) AS lng,
                min(lng) AS west, min(lat) AS south, max(lng) AS east, max(lat) AS north,
                sum(critical_count > 0) AS withCritical
         FROM establishments
         WHERE lat BETWEEN $south AND $north AND lng BETWEEN $west AND $east
         GROUP BY CAST(floor(lat / $cell) AS INTEGER), CAST(floor(lng / $cell) AS INTEGER)`,
      )
      .all({ ...b, cell }) as ClusterItem[];
  }

  /**
   * Every establishment whose name contains `query` (case- and accent-insensitive),
   * nearest to `near` first when given, otherwise alphabetical.
   */
  search(query: string, near?: { lat: number; lng: number }): SearchResult[] {
    const q = foldForSearch(query);
    if (!q) return [];
    const select = `SELECT id, name, address, city, lat, lng, critical_count AS critical, noncritical_count AS noncritical
                    FROM establishments WHERE instr(search_name, $q) > 0`;
    if (!near) {
      return (this.db.query(`${select} ORDER BY name, id`).all({ q }) as Omit<SearchResult, "distanceKm">[]).map((r) => ({
        ...r,
        distanceKm: null,
      }));
    }
    // Matches number in the thousands at most, so sort by true distance here rather than approximating in SQL.
    const rows = this.db.query(`${select} ORDER BY name, id`).all({ q }) as Omit<SearchResult, "distanceKm">[];
    return rows
      .map((r) => ({ ...r, distanceKm: haversineKm(near.lat, near.lng, r.lat, r.lng) }))
      .sort((a, b) => a.distanceKm - b.distanceKm); // stable, so equal distances stay alphabetical
  }

  getEstablishment(id: string): (EstablishmentRow & { violations: Violation[] }) | null {
    const row = this.db
      .query(
        `SELECT id, name, address, city, zip, county, description, inspection_date, critical_count, noncritical_count,
                crit_not_corrected, comments, lat, lng
         FROM establishments WHERE id = $id`,
      )
      .get({ id }) as EstablishmentRow | null;
    if (!row) return null;
    const violations = (
      this.db
        .query("SELECT code, is_critical, description FROM violations WHERE establishment_id = $id ORDER BY seq")
        .all({ id }) as { code: string | null; is_critical: number; description: string }[]
    ).map((v) => ({ code: v.code, critical: v.is_critical === 1, description: v.description }));
    return { ...row, violations };
  }

  getMeta(key: string): string | null {
    const row = this.db.query("SELECT value FROM sync_meta WHERE key = $key").get({ key }) as { value: string } | null;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.query("INSERT INTO sync_meta (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run({ key, value });
  }

  /**
   * Replace every establishment in one transaction, so readers see either the
   * old data set or the new one and never a half-loaded mix.
   */
  replaceAll(rows: NewEstablishment[], meta: Record<string, string>): void {
    const insertEst = this.db.query(
      `INSERT INTO establishments (id, name, search_name, address, city, zip, county, description, inspection_date,
         critical_count, noncritical_count, crit_not_corrected, comments, lat, lng)
       VALUES ($id, $name, $search_name, $address, $city, $zip, $county, $description, $inspection_date,
         $critical_count, $noncritical_count, $crit_not_corrected, $comments, $lat, $lng)`,
    );
    const insertViolation = this.db.query(
      "INSERT INTO violations (establishment_id, seq, code, is_critical, description) VALUES ($id, $seq, $code, $critical, $description)",
    );
    this.db.transaction(() => {
      this.db.exec("DELETE FROM violations; DELETE FROM establishments;");
      for (const { violations, ...row } of rows) {
        insertEst.run({ ...row, search_name: foldForSearch(row.name) });
        violations.forEach((v, seq) =>
          insertViolation.run({ id: row.id, seq, code: v.code, critical: v.critical ? 1 : 0, description: v.description }),
        );
      }
      for (const [k, v] of Object.entries(meta)) this.setMeta(k, v);
    })();
  }
}

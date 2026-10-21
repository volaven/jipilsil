import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class Store {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, 'ai.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT, id TEXT, body TEXT NOT NULL, PRIMARY KEY(kind,id));`);
  }
  get(kind, id) { const row = this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(row.body) : null; }
  put(kind, id, value) { this.db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?)').run(kind, id, JSON.stringify(value)); return value; }
  all(kind) { return this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r => JSON.parse(r.body)); }
  export() { return { version: 1, exportedAt: Date.now(), records: ['config', 'job', 'summary'].flatMap(kind => this.db.prepare('SELECT id,body FROM records WHERE kind=?').all(kind).map(r => ({ kind, id: r.id, value: JSON.parse(r.body) }))) }; }
  restore(data) {
    if (data?.version !== 1 || !Array.isArray(data.records) || data.records.length > 100000) throw new Error('올바른 AI 이력 백업이 아닙니다.');
    for (const r of data.records) {
      if (!['config','job','summary'].includes(r.kind) || typeof r.id !== 'string' || !r.value || typeof r.value !== 'object') throw new Error('백업 항목이 잘못되었습니다.');
      if (r.kind === 'job' && (!r.value.workId || !Array.isArray(r.value.results) || !['council','draft','summarize'].includes(r.value.kind))) throw new Error('작업 이력 형식이 잘못되었습니다.');
    }
    let count = 0;
    this.db.exec('BEGIN');
    try {
      for (const r of data.records) if (!this.get(r.kind, r.id)) {
        const v = structuredClone(r.value);
        if (r.kind === 'job') { v.id = r.id; v.status = 'restored'; for (const result of v.results) if (!['completed','failed','cancelled'].includes(result.status)) result.status = 'interrupted'; }
        this.put(r.kind, r.id, v); count++;
      }
      this.db.exec('COMMIT');
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
    return count;
  }
  close() { this.db.close(); }
}

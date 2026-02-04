declare module 'duckdb' {
  // Minimal typings to satisfy TypeScript. Runtime behavior is provided by the `duckdb` package.
  export class Database {
    constructor(path?: string, callback?: (err: Error | null) => void);
    close(callback?: (err?: Error | null) => void): void;
  }

  export class Connection {
    constructor(db: Database, callback?: (err: Error | null) => void);
    exec(sql: string, callback?: (err?: Error | null) => void): void;
    all(sql: string, callback: (err: Error | null, rows?: any[]) => void): void;
    close(callback?: (err?: Error | null) => void): void;
  }
}


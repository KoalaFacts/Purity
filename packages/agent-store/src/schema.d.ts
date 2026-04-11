import type { DatabaseSync } from "node:sqlite";
export declare const AGENT_STORE_SCHEMA_VERSION = 2;
export declare function getAgentStoreSchemaVersion(db: DatabaseSync): number;
export declare function migrateAgentStore(db: DatabaseSync): void;

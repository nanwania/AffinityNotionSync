import { pgTable, text, serial, integer, boolean, timestamp, jsonb, unique, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const syncPairs = pgTable("sync_pairs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  affinityListId: text("affinity_list_id").notNull(),
  affinityListName: text("affinity_list_name").notNull(),
  notionDatabaseId: text("notion_database_id").notNull(),
  notionDatabaseName: text("notion_database_name").notNull(),
  syncDirection: text("sync_direction").notNull().default("bidirectional"), // bidirectional, affinity-to-notion, notion-to-affinity
  syncFrequency: integer("sync_frequency").notNull().default(15), // minutes
  fieldMappings: jsonb("field_mappings").notNull().default([]), // array of {affinityField, notionProperty}
  statusFilters: jsonb("status_filters").notNull().default([]), // array of status names to sync
  isActive: boolean("is_active").notNull().default(true),
  lastSync: timestamp("last_sync"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const syncHistory = pgTable("sync_history", {
  id: serial("id").primaryKey(),
  syncPairId: integer("sync_pair_id").notNull().references(() => syncPairs.id),
  status: text("status").notNull(), // success, error, warning
  recordsUpdated: integer("records_updated").notNull().default(0),
  recordsCreated: integer("records_created").notNull().default(0),
  recordsDeleted: integer("records_deleted").notNull().default(0),
  conflictsFound: integer("conflicts_found").notNull().default(0),
  duration: integer("duration"), // milliseconds
  errorMessage: text("error_message"),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const conflicts = pgTable("conflicts", {
  id: serial("id").primaryKey(),
  syncPairId: integer("sync_pair_id").notNull().references(() => syncPairs.id),
  recordId: text("record_id").notNull(), // the entity ID from Affinity or page ID from Notion
  recordType: text("record_type").notNull(), // person, organization, opportunity
  fieldName: text("field_name").notNull(),
  affinityValue: jsonb("affinity_value"),
  notionValue: jsonb("notion_value"),
  affinityLastModified: timestamp("affinity_last_modified"),
  notionLastModified: timestamp("notion_last_modified"),
  status: text("status").notNull().default("pending"), // pending, resolved, skipped
  resolution: text("resolution"), // affinity, notion, manual
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const syncedRecords = pgTable("synced_records", {
  id: serial("id").primaryKey(),
  syncPairId: integer("sync_pair_id").notNull().references(() => syncPairs.id, { onDelete: "cascade" }),
  recordId: text("record_id").notNull(),
  recordType: text("record_type").notNull(),
  affinityId: text("affinity_id").notNull(),
  notionPageId: text("notion_page_id").notNull(),
  fieldValuesHash: text("field_values_hash").notNull(), // SHA256 hash of normalized field values
  lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
  affinityLastModified: timestamp("affinity_last_modified").notNull(),
  notionLastModified: timestamp("notion_last_modified").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
}, (table) => ({
  uniqueRecord: unique().on(table.syncPairId, table.recordId),
  affinityIdIndex: index("synced_records_affinity_id_idx").on(table.affinityId),
  notionPageIdIndex: index("synced_records_notion_page_id_idx").on(table.notionPageId)
}));

export const syncPairsRelations = relations(syncPairs, ({ many }) => ({
  syncHistory: many(syncHistory),
  conflicts: many(conflicts),
  syncedRecords: many(syncedRecords),
}));

export const syncHistoryRelations = relations(syncHistory, ({ one }) => ({
  syncPair: one(syncPairs, {
    fields: [syncHistory.syncPairId],
    references: [syncPairs.id],
  }),
}));

export const conflictsRelations = relations(conflicts, ({ one }) => ({
  syncPair: one(syncPairs, {
    fields: [conflicts.syncPairId],
    references: [syncPairs.id],
  }),
}));

export const syncedRecordsRelations = relations(syncedRecords, ({ one }) => ({
  syncPair: one(syncPairs, {
    fields: [syncedRecords.syncPairId],
    references: [syncPairs.id],
  }),
}));

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertSyncPairSchema = createInsertSchema(syncPairs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSyncHistorySchema = createInsertSchema(syncHistory).omit({
  id: true,
  createdAt: true,
});

export const insertConflictSchema = createInsertSchema(conflicts).omit({
  id: true,
  createdAt: true,
});

export const insertSyncedRecordSchema = createInsertSchema(syncedRecords).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type SyncPair = typeof syncPairs.$inferSelect;
export type InsertSyncPair = z.infer<typeof insertSyncPairSchema>;
export type SyncHistory = typeof syncHistory.$inferSelect;
export type InsertSyncHistory = z.infer<typeof insertSyncHistorySchema>;
export type Conflict = typeof conflicts.$inferSelect;
export type InsertConflict = z.infer<typeof insertConflictSchema>;
export type SyncedRecord = typeof syncedRecords.$inferSelect;
export type InsertSyncedRecord = z.infer<typeof insertSyncedRecordSchema>;

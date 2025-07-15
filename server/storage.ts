import { 
  users, 
  syncPairs, 
  syncHistory, 
  conflicts,
  syncedRecords,
  affinityFieldData,
  type User, 
  type InsertUser, 
  type SyncPair, 
  type InsertSyncPair,
  type SyncHistory,
  type InsertSyncHistory,
  type Conflict,
  type InsertConflict,
  type SyncedRecord,
  type InsertSyncedRecord,
  type AffinityFieldData,
  type InsertAffinityFieldData
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Sync Pairs
  getSyncPairs(): Promise<SyncPair[]>;
  getSyncPair(id: number): Promise<SyncPair | undefined>;
  createSyncPair(syncPair: InsertSyncPair): Promise<SyncPair>;
  updateSyncPair(id: number, syncPair: Partial<InsertSyncPair>): Promise<SyncPair>;
  deleteSyncPair(id: number): Promise<void>;
  
  // Sync History
  getSyncHistory(syncPairId?: number): Promise<SyncHistory[]>;
  createSyncHistory(syncHistory: InsertSyncHistory): Promise<SyncHistory>;
  
  // Conflicts
  getConflicts(syncPairId?: number): Promise<Conflict[]>;
  getPendingConflicts(syncPairId?: number): Promise<Conflict[]>;
  createConflict(conflict: InsertConflict): Promise<Conflict>;
  resolveConflict(id: number, resolution: string): Promise<Conflict>;
  deleteConflict(id: number): Promise<void>;
  
  // Synced Records
  getSyncedRecord(syncPairId: number, recordId: string): Promise<SyncedRecord | undefined>;
  createOrUpdateSyncedRecord(syncedRecord: InsertSyncedRecord): Promise<SyncedRecord>;
  deleteSyncedRecord(syncPairId: number, recordId: string): Promise<void>;
  
  // Affinity Field Data Cache
  getAffinityFieldData(affinityId: string): Promise<AffinityFieldData | undefined>;
  createOrUpdateAffinityFieldData(fieldData: InsertAffinityFieldData): Promise<AffinityFieldData>;
  deleteAffinityFieldData(affinityId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getSyncPairs(): Promise<SyncPair[]> {
    return await db.select().from(syncPairs).orderBy(desc(syncPairs.createdAt));
  }

  async getSyncPair(id: number): Promise<SyncPair | undefined> {
    const [syncPair] = await db.select().from(syncPairs).where(eq(syncPairs.id, id));
    return syncPair || undefined;
  }

  async createSyncPair(syncPair: InsertSyncPair): Promise<SyncPair> {
    const [created] = await db
      .insert(syncPairs)
      .values({ ...syncPair, updatedAt: new Date() })
      .returning();
    return created;
  }

  async updateSyncPair(id: number, syncPair: Partial<InsertSyncPair>): Promise<SyncPair> {
    const [updated] = await db
      .update(syncPairs)
      .set({ ...syncPair, updatedAt: new Date() })
      .where(eq(syncPairs.id, id))
      .returning();
    return updated;
  }

  async deleteSyncPair(id: number): Promise<void> {
    await db.delete(syncPairs).where(eq(syncPairs.id, id));
  }

  async getSyncHistory(syncPairId?: number): Promise<SyncHistory[]> {
    const query = db.select().from(syncHistory);
    if (syncPairId) {
      return await query.where(eq(syncHistory.syncPairId, syncPairId)).orderBy(desc(syncHistory.createdAt));
    }
    return await query.orderBy(desc(syncHistory.createdAt));
  }

  async createSyncHistory(syncHistoryData: InsertSyncHistory): Promise<SyncHistory> {
    const [created] = await db
      .insert(syncHistory)
      .values(syncHistoryData)
      .returning();
    return created;
  }

  async getConflicts(syncPairId?: number): Promise<Conflict[]> {
    const query = db.select().from(conflicts);
    if (syncPairId) {
      return await query.where(eq(conflicts.syncPairId, syncPairId)).orderBy(desc(conflicts.createdAt));
    }
    return await query.orderBy(desc(conflicts.createdAt));
  }

  async getPendingConflicts(syncPairId?: number): Promise<Conflict[]> {
    if (syncPairId) {
      return await db.select().from(conflicts)
        .where(and(eq(conflicts.syncPairId, syncPairId), eq(conflicts.status, "pending")))
        .orderBy(desc(conflicts.createdAt));
    }
    return await db.select().from(conflicts)
      .where(eq(conflicts.status, "pending"))
      .orderBy(desc(conflicts.createdAt));
  }

  async createConflict(conflict: InsertConflict): Promise<Conflict> {
    const [created] = await db
      .insert(conflicts)
      .values(conflict)
      .returning();
    return created;
  }

  async resolveConflict(id: number, resolution: string): Promise<Conflict> {
    const [updated] = await db
      .update(conflicts)
      .set({ 
        status: "resolved", 
        resolution, 
        resolvedAt: new Date() 
      })
      .where(eq(conflicts.id, id))
      .returning();
    return updated;
  }

  async deleteConflict(id: number): Promise<void> {
    await db.delete(conflicts).where(eq(conflicts.id, id));
  }

  async getSyncedRecord(syncPairId: number, recordId: string): Promise<SyncedRecord | undefined> {
    const [record] = await db.select()
      .from(syncedRecords)
      .where(and(eq(syncedRecords.syncPairId, syncPairId), eq(syncedRecords.recordId, recordId)));
    return record || undefined;
  }

  async createOrUpdateSyncedRecord(syncedRecord: InsertSyncedRecord): Promise<SyncedRecord> {
    // Try to find existing record
    const existing = await this.getSyncedRecord(syncedRecord.syncPairId, syncedRecord.recordId);
    
    if (existing) {
      // Update existing record
      const [updated] = await db.update(syncedRecords)
        .set({
          ...syncedRecord,
          updatedAt: new Date()
        })
        .where(eq(syncedRecords.id, existing.id))
        .returning();
      return updated;
    } else {
      // Create new record
      const [created] = await db.insert(syncedRecords)
        .values(syncedRecord)
        .returning();
      return created;
    }
  }

  async deleteSyncedRecord(syncPairId: number, recordId: string): Promise<void> {
    await db.delete(syncedRecords)
      .where(and(eq(syncedRecords.syncPairId, syncPairId), eq(syncedRecords.recordId, recordId)));
  }

  async getAffinityFieldData(affinityId: string): Promise<AffinityFieldData | undefined> {
    const [fieldData] = await db
      .select()
      .from(affinityFieldData)
      .where(eq(affinityFieldData.affinityId, affinityId));
    return fieldData || undefined;
  }

  async createOrUpdateAffinityFieldData(fieldData: InsertAffinityFieldData): Promise<AffinityFieldData> {
    const [result] = await db
      .insert(affinityFieldData)
      .values(fieldData)
      .onConflictDoUpdate({
        target: affinityFieldData.affinityId,
        set: {
          fieldData: fieldData.fieldData,
          organizationData: fieldData.organizationData,
          personData: fieldData.personData,
          lastFetchedAt: new Date(),
          affinityLastModified: fieldData.affinityLastModified,
          updatedAt: new Date()
        }
      })
      .returning();
    return result;
  }

  async deleteAffinityFieldData(affinityId: string): Promise<void> {
    await db
      .delete(affinityFieldData)
      .where(eq(affinityFieldData.affinityId, affinityId));
  }
}

export const storage = new DatabaseStorage();

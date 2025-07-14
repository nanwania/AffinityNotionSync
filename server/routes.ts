import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { affinityService } from "./services/affinity";
import { notionService } from "./services/notion";
import { syncService } from "./services/sync";
import { insertSyncPairSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Sync Pairs routes
  app.get("/api/sync-pairs", async (req, res) => {
    try {
      const syncPairs = await storage.getSyncPairs();
      res.json(syncPairs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sync pairs" });
    }
  });

  app.post("/api/sync-pairs", async (req, res) => {
    try {
      const validatedData = insertSyncPairSchema.parse(req.body);
      const syncPair = await storage.createSyncPair(validatedData);
      
      // Start scheduled sync if active
      if (syncPair.isActive) {
        await syncService.startScheduledSync(syncPair);
      }
      
      res.json(syncPair);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create sync pair" });
      }
    }
  });

  app.put("/api/sync-pairs/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertSyncPairSchema.partial().parse(req.body);
      
      const syncPair = await storage.updateSyncPair(id, validatedData);
      
      // Update scheduled sync
      if (syncPair.isActive) {
        await syncService.startScheduledSync(syncPair);
      } else {
        await syncService.stopScheduledSync(id);
      }
      
      res.json(syncPair);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update sync pair" });
      }
    }
  });

  app.delete("/api/sync-pairs/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await syncService.stopScheduledSync(id);
      await storage.deleteSyncPair(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete sync pair" });
    }
  });

  // Sync operations
  app.post("/api/sync-pairs/:id/sync", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const result = await syncService.syncPair(id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to sync pair" });
    }
  });

  // Sync history
  app.get("/api/sync-history", async (req, res) => {
    try {
      const syncPairId = req.query.syncPairId ? parseInt(req.query.syncPairId as string) : undefined;
      const history = await storage.getSyncHistory(syncPairId);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sync history" });
    }
  });

  // Conflicts
  app.get("/api/conflicts", async (req, res) => {
    try {
      const syncPairId = req.query.syncPairId ? parseInt(req.query.syncPairId as string) : undefined;
      const conflicts = await storage.getConflicts(syncPairId);
      res.json(conflicts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch conflicts" });
    }
  });

  app.get("/api/conflicts/pending", async (req, res) => {
    try {
      const syncPairId = req.query.syncPairId ? parseInt(req.query.syncPairId as string) : undefined;
      const conflicts = await storage.getPendingConflicts(syncPairId);
      res.json(conflicts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pending conflicts" });
    }
  });

  app.post("/api/conflicts/:id/resolve", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { resolution } = req.body;
      
      if (!resolution || !['affinity', 'notion'].includes(resolution)) {
        return res.status(400).json({ error: "Invalid resolution. Must be 'affinity' or 'notion'" });
      }
      
      const conflict = await storage.resolveConflict(id, resolution);
      res.json(conflict);
    } catch (error) {
      res.status(500).json({ error: "Failed to resolve conflict" });
    }
  });

  app.delete("/api/conflicts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteConflict(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete conflict" });
    }
  });

  // Affinity API routes
  app.get("/api/affinity/lists", async (req, res) => {
    try {
      const lists = await affinityService.getLists();
      res.json(lists);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch Affinity lists" });
    }
  });

  app.get("/api/affinity/lists/:id/fields", async (req, res) => {
    try {
      const listId = parseInt(req.params.id);
      const fields = await affinityService.getFields(listId);
      res.json(fields);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch Affinity fields" });
    }
  });

  app.get("/api/affinity/rate-limit", async (req, res) => {
    try {
      const rateLimit = await affinityService.getRateLimit();
      res.json(rateLimit);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch rate limit" });
    }
  });

  // Notion API routes
  app.get("/api/notion/databases", async (req, res) => {
    try {
      const databases = await notionService.getNotionDatabases();
      res.json(databases);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch Notion databases" });
    }
  });

  app.get("/api/notion/databases/:id", async (req, res) => {
    try {
      const databaseId = req.params.id;
      const database = await notionService.getDatabase(databaseId);
      res.json(database);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch Notion database" });
    }
  });

  app.post("/api/notion/test-database", async (req, res) => {
    try {
      const testDb = await notionService.createDatabaseIfNotExists('Test Sync Database', {
        Name: { title: {} },
        Email: { email: {} },
        Status: { 
          select: { 
            options: [
              { name: "Active", color: "green" },
              { name: "Inactive", color: "red" }
            ]
          }
        }
      });
      res.json(testDb);
    } catch (error: any) {
      console.error('Error creating test database:', error);
      res.status(500).json({ error: 'Failed to create test database', details: error.message });
    }
  });

  // Dashboard stats
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const syncPairs = await storage.getSyncPairs();
      const pendingConflicts = await storage.getPendingConflicts();
      const recentHistory = await storage.getSyncHistory();
      
      const activeSyncs = syncPairs.filter(sp => sp.isActive).length;
      const lastSync = recentHistory.length > 0 ? recentHistory[0].createdAt : null;
      const totalRecordsSynced = recentHistory.reduce((sum, h) => sum + h.recordsUpdated + h.recordsCreated, 0);
      
      res.json({
        activeSyncs,
        conflicts: pendingConflicts.length,
        lastSync,
        recordsSynced: totalRecordsSynced
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  const httpServer = createServer(app);

  // Initialize scheduled syncs on server startup
  syncService.initializeScheduledSyncs().catch(console.error);

  return httpServer;
}

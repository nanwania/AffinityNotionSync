import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { affinityService } from "./services/affinity";
import { notionService } from "./services/notion";
import { syncService } from "./services/sync";
import { insertSyncPairSchema } from "@shared/schema";
import { z } from "zod";
import crypto from "crypto";

// Webhook signature verification
const verifyWebhookSignature = (body: string, signature: string, secret: string): boolean => {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
};

// Request validation middleware
const validateRequest = (schema: z.ZodSchema) => {
  return (req: any, res: any, next: any) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Validation failed", 
          details: error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        });
      }
      next(error);
    }
  };
};

// Error handling middleware
const handleAsyncRoute = (fn: Function) => {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      activeSyncs: syncService.getActiveSyncCount()
    });
  });

  // System metrics endpoint
  app.get("/api/metrics", handleAsyncRoute(async (req: any, res: any) => {
    const syncPairs = await storage.getSyncPairs();
    const recentHistory = await storage.getSyncHistory();
    
    const metrics = {
      totalSyncPairs: syncPairs.length,
      activeSyncPairs: syncPairs.filter(sp => sp.isActive).length,
      recentSyncs: recentHistory.slice(0, 10),
      successRate: recentHistory.length > 0 
        ? recentHistory.filter(h => h.status === 'success').length / recentHistory.length 
        : 1
    };
    
    res.json(metrics);
  }));

  // Sync Pairs routes
  app.get("/api/sync-pairs", handleAsyncRoute(async (req: any, res: any) => {
    const syncPairs = await storage.getSyncPairs();
    res.json(syncPairs);
  }));

  app.post("/api/sync-pairs", 
    validateRequest(insertSyncPairSchema),
    handleAsyncRoute(async (req: any, res: any) => {
      const syncPair = await storage.createSyncPair(req.body);
      
      // Start scheduled sync if active
      if (syncPair.isActive) {
        await syncService.startScheduledSync(syncPair);
      }
      
      res.status(201).json(syncPair);
    })
  );

  app.put("/api/sync-pairs/:id", 
    validateRequest(insertSyncPairSchema.partial()),
    handleAsyncRoute(async (req: any, res: any) => {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid sync pair ID" });
      }

      const syncPair = await storage.updateSyncPair(id, req.body);
      
      // Update scheduled sync
      if (syncPair.isActive) {
        await syncService.startScheduledSync(syncPair);
      } else {
        await syncService.stopScheduledSync(id);
      }
      
      res.json(syncPair);
    })
  );

  app.delete("/api/sync-pairs/:id", handleAsyncRoute(async (req: any, res: any) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid sync pair ID" });
    }

    await syncService.stopScheduledSync(id);
    await storage.deleteSyncPair(id);
    res.json({ success: true });
  }));

  // Bulk operations for sync pairs
  app.post("/api/sync-pairs/bulk-action", 
    validateRequest(z.object({
      action: z.enum(['activate', 'deactivate', 'sync', 'delete']),
      syncPairIds: z.array(z.number()).min(1)
    })),
    handleAsyncRoute(async (req: any, res: any) => {
      const { action, syncPairIds } = req.body;
      const results = [];
      
      for (const id of syncPairIds) {
        try {
          switch (action) {
            case 'activate':
              const activatedPair = await storage.updateSyncPair(id, { isActive: true });
              await syncService.startScheduledSync(activatedPair);
              results.push({ id, success: true, message: 'Activated' });
              break;
              
            case 'deactivate':
              await storage.updateSyncPair(id, { isActive: false });
              await syncService.stopScheduledSync(id);
              results.push({ id, success: true, message: 'Deactivated' });
              break;
              
            case 'sync':
              const syncResult = await syncService.syncPair(id);
              results.push({ 
                id, 
                success: syncResult.success, 
                message: syncResult.success ? 'Sync completed' : syncResult.errorMessage 
              });
              break;
              
            case 'delete':
              await syncService.stopScheduledSync(id);
              await storage.deleteSyncPair(id);
              results.push({ id, success: true, message: 'Deleted' });
              break;
          }
        } catch (error: any) {
          results.push({ 
            id, 
            success: false, 
            message: error.message 
          });
        }
      }
      
      res.json({ results });
    })
  );

  // Sync operations
  app.post("/api/sync-pairs/:id/sync", handleAsyncRoute(async (req: any, res: any) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid sync pair ID" });
    }

    const result = await syncService.syncPair(id);
    res.json(result);
  }));

  // Sync preview endpoint (shows what would change without executing)
  app.post("/api/sync-pairs/:id/preview", handleAsyncRoute(async (req: any, res: any) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid sync pair ID" });
    }

    // This would be implemented to show a preview of changes
    const syncPair = await storage.getSyncPair(id);
    if (!syncPair) {
      return res.status(404).json({ error: "Sync pair not found" });
    }

    // Preview logic would go here
    const preview = {
      toBeCreated: 0,
      toBeUpdated: 0,
      potentialConflicts: 0,
      changes: []
    };

    res.json(preview);
  }));

  // Clear stuck sync processes
  app.post('/api/sync/clear-active', handleAsyncRoute(async (req: any, res: any) => {
    syncService.clearActiveSyncs();
    res.json({ success: true, message: 'Cleared all active syncs' });
  }));

  // Sync history with pagination
  app.get("/api/sync-history", handleAsyncRoute(async (req: any, res: any) => {
    const syncPairId = req.query.syncPairId ? parseInt(req.query.syncPairId as string) : undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    
    if (limit > 100) {
      return res.status(400).json({ error: "Limit cannot exceed 100" });
    }

    const history = await storage.getSyncHistory(syncPairId);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    res.json({
      data: history.slice(startIndex, endIndex),
      pagination: {
        page,
        limit,
        total: history.length,
        totalPages: Math.ceil(history.length / limit)
      }
    });
  }));

  // Conflicts management
  app.get("/api/conflicts", handleAsyncRoute(async (req: any, res: any) => {
    const syncPairId = req.query.syncPairId ? parseInt(req.query.syncPairId as string) : undefined;
    const status = req.query.status as string;
    
    let conflicts;
    if (status === 'pending') {
      conflicts = await storage.getPendingConflicts(syncPairId);
    } else {
      conflicts = await storage.getConflicts(syncPairId);
    }
    
    res.json(conflicts);
  }));

  app.get("/api/conflicts/pending", handleAsyncRoute(async (req: any, res: any) => {
    const syncPairId = req.query.syncPairId ? parseInt(req.query.syncPairId as string) : undefined;
    const conflicts = await storage.getPendingConflicts(syncPairId);
    res.json(conflicts);
  }));

  app.post("/api/conflicts/:id/resolve", 
    validateRequest(z.object({
      resolution: z.enum(['affinity', 'notion'])
    })),
    handleAsyncRoute(async (req: any, res: any) => {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid conflict ID" });
      }

      const { resolution } = req.body;
      const resolvedConflict = await storage.resolveConflict(id, resolution);
      res.json(resolvedConflict);
    })
  );

  // Bulk conflict resolution
  app.post("/api/conflicts/bulk-resolve",
    validateRequest(z.object({
      conflictIds: z.array(z.number()).min(1),
      resolution: z.enum(['affinity', 'notion'])
    })),
    handleAsyncRoute(async (req: any, res: any) => {
      const { conflictIds, resolution } = req.body;
      const results = [];
      
      for (const id of conflictIds) {
        try {
          const resolvedConflict = await storage.resolveConflict(id, resolution);
          results.push({ id, success: true, conflict: resolvedConflict });
        } catch (error: any) {
          results.push({ id, success: false, error: error.message });
        }
      }
      
      res.json({ results });
    })
  );

  // Webhook endpoints for real-time syncing
  app.post("/webhooks/affinity", 
    handleAsyncRoute(async (req: any, res: any) => {
      // Verify webhook signature if secret is provided
      const signature = req.headers['x-affinity-signature'] as string;
      const webhookSecret = process.env.AFFINITY_WEBHOOK_SECRET;
      
      if (webhookSecret && signature) {
        const body = JSON.stringify(req.body);
        if (!verifyWebhookSignature(body, signature, webhookSecret)) {
          return res.status(401).json({ error: "Invalid webhook signature" });
        }
      }

      const { entity_id, list_id, event_type } = req.body;
      
      if (event_type === 'updated' || event_type === 'created') {
        // Find sync pairs that match this list
        const syncPairs = await storage.getSyncPairs();
        const matchingSyncPairs = syncPairs.filter(sp => 
          sp.affinityListId === list_id.toString() && sp.isActive
        );
        
        // Trigger syncs for matching pairs
        for (const syncPair of matchingSyncPairs) {
          // Don't await - let them run in background
          syncService.syncPair(syncPair.id).catch(error => {
            console.error(`Webhook-triggered sync failed for pair ${syncPair.id}:`, error);
          });
        }
        
        res.json({ 
          success: true, 
          message: `Triggered ${matchingSyncPairs.length} syncs`,
          triggeredSyncPairs: matchingSyncPairs.map(sp => sp.id)
        });
      } else {
        res.json({ success: true, message: 'Event type not handled' });
      }
    })
  );

  app.post("/webhooks/notion",
    handleAsyncRoute(async (req: any, res: any) => {
      // Similar webhook handling for Notion
      const { object, event_type } = req.body;
      
      if (event_type === 'page.updated' && object.object === 'page') {
        // Find sync pairs that include this database
        const syncPairs = await storage.getSyncPairs();
        const matchingSyncPairs = syncPairs.filter(sp => 
          sp.notionDatabaseId === object.parent?.database_id && sp.isActive
        );
        
        for (const syncPair of matchingSyncPairs) {
          syncService.syncPair(syncPair.id).catch(error => {
            console.error(`Webhook-triggered sync failed for pair ${syncPair.id}:`, error);
          });
        }
        
        res.json({ 
          success: true, 
          message: `Triggered ${matchingSyncPairs.length} syncs` 
        });
      } else {
        res.json({ success: true, message: 'Event type not handled' });
      }
    })
  );

  // API testing endpoints
  app.get("/api/test/affinity", handleAsyncRoute(async (req: any, res: any) => {
    try {
      const lists = await affinityService.getLists();
      res.json({ 
        success: true, 
        message: "Affinity API connection successful",
        listsCount: lists.length 
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }));

  app.get("/api/test/notion", handleAsyncRoute(async (req: any, res: any) => {
    try {
      const databases = await notionService.getDatabases();
      res.json({ 
        success: true, 
        message: "Notion API connection successful",
        databasesCount: databases.length 
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }));

  // Affinity data endpoints
  app.get("/api/affinity/lists", handleAsyncRoute(async (req: any, res: any) => {
    const lists = await affinityService.getLists();
    res.json(lists);
  }));

  app.get("/api/affinity/lists/:listId/entries", handleAsyncRoute(async (req: any, res: any) => {
    const { listId } = req.params;
    const entries = await affinityService.getListEntries(listId);
    res.json(entries);
  }));

  app.get("/api/affinity/lists/:listId/fields", handleAsyncRoute(async (req: any, res: any) => {
    const { listId } = req.params;
    const fields = await affinityService.getListFields(listId);
    res.json(fields);
  }));

  app.get("/api/affinity/field-types", handleAsyncRoute(async (req: any, res: any) => {
    const fieldTypes = await affinityService.getAllFieldTypes();
    res.json(fieldTypes);
  }));

  // Notion data endpoints
  app.get("/api/notion/databases", handleAsyncRoute(async (req: any, res: any) => {
    const databases = await notionService.getDatabases();
    res.json(databases);
  }));

  app.get("/api/notion/databases/:databaseId/properties", handleAsyncRoute(async (req: any, res: any) => {
    const { databaseId } = req.params;
    const database = await notionService.getDatabase(databaseId);
    res.json(database.properties);
  }));

  app.post("/api/notion/databases/:databaseId/properties",
    validateRequest(z.object({
      name: z.string().min(1),
      type: z.string().min(1)
    })),
    handleAsyncRoute(async (req: any, res: any) => {
      const { databaseId } = req.params;
      const { name, type } = req.body;
      
      const updatedDatabase = await notionService.createProperty(databaseId, name, type);
      res.json(updatedDatabase);
    })
  );

  // Global error handling middleware
  app.use((error: any, req: any, res: any, next: any) => {
    console.error('Unhandled route error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Validation error",
        details: error.errors
      });
    }
    
    res.status(500).json({
      error: "Internal server error",
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  });

  const server = createServer(app);
  return server;
}
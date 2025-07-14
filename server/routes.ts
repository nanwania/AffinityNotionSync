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

  // Clear stuck sync processes
  app.post('/api/sync/clear-active', async (req, res) => {
    try {
      syncService.clearActiveSyncs();
      res.json({ success: true, message: 'Cleared all active syncs' });
    } catch (error) {
      console.error('Clear active syncs error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
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
      
      // Add organization fields as virtual fields since entities contain this data
      const fieldsWithOrganization = [
        ...fields,
        {
          id: -1,
          name: "Entity Name",
          list_id: listId,
          value_type: 1, // Text type
          allows_multiple: false,
          track_changes: false,
          enrichment_source: "entity",
          dropdown_options: []
        },
        {
          id: -2, 
          name: "Entity Domain",
          list_id: listId,
          value_type: 1, // Text type
          allows_multiple: false,
          track_changes: false,
          enrichment_source: "entity",
          dropdown_options: []
        },
        {
          id: -3,
          name: "Entity Type",
          list_id: listId,
          value_type: 1, // Text type
          allows_multiple: false,
          track_changes: false,
          enrichment_source: "entity",
          dropdown_options: []
        },
        {
          id: -4,
          name: "Name",
          list_id: listId,
          value_type: 1, // Text type
          allows_multiple: false,
          track_changes: false,
          enrichment_source: "entity",
          dropdown_options: []
        },
        {
          id: -5,
          name: "Opportunity ID",
          list_id: listId,
          value_type: 1, // Text type
          allows_multiple: false,
          track_changes: false,
          enrichment_source: "entity",
          dropdown_options: []
        },
        {
          id: -6,
          name: "Organization Name",
          list_id: listId,
          value_type: 1, // Text type
          allows_multiple: false,
          track_changes: false,
          enrichment_source: "entity",
          dropdown_options: []
        },
        {
          id: -7,
          name: "Organization ID",
          list_id: listId,
          value_type: 1, // Text type
          allows_multiple: false,
          track_changes: false,
          enrichment_source: "entity",
          dropdown_options: []
        }
      ];
      
      res.json(fieldsWithOrganization);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch Affinity fields" });
    }
  });

  // New endpoint for comprehensive field mapping with all entity types
  app.get("/api/affinity/lists/:id/all-fields", async (req, res) => {
    try {
      const listId = parseInt(req.params.id);
      const allFields = await affinityService.getAllFieldTypes(listId);
      
      // Add virtual fields for entity data
      const virtualFields = [
        {
          id: -1,
          name: "Entity Name",
          list_id: listId,
          value_type: 1,
          allows_multiple: false,
          track_changes: false,
          field_type: "virtual",
          entity_type: "all"
        },
        {
          id: -2,
          name: "Entity Domain",
          list_id: listId,
          value_type: 1,
          allows_multiple: false,
          track_changes: false,
          field_type: "virtual",
          entity_type: "organization"
        },
        {
          id: -3,
          name: "Entity Type",
          list_id: listId,
          value_type: 1,
          allows_multiple: false,
          track_changes: false,
          field_type: "virtual",
          entity_type: "all"
        },
        {
          id: -7,
          name: "Organization ID",
          list_id: listId,
          value_type: 2,
          allows_multiple: false,
          track_changes: false,
          field_type: "virtual",
          entity_type: "organization"
        }
      ];

      // Organize fields by type with metadata
      const organizedFields = {
        virtual: virtualFields,
        global: allFields.globalFields.map(f => ({ ...f, field_type: "global", entity_type: "all" })),
        list: allFields.listFields.map(f => ({ ...f, field_type: "list", entity_type: "all" })),
        person: allFields.personFields.map(f => ({ ...f, field_type: "person", entity_type: "person" })),
        organization: allFields.organizationFields.map(f => ({ ...f, field_type: "organization", entity_type: "organization" })),
        opportunity: allFields.opportunityFields.map(f => ({ ...f, field_type: "opportunity", entity_type: "opportunity" }))
      };

      res.json(organizedFields);
    } catch (error) {
      res.status(500).json({ 
        error: "Failed to fetch all field types",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get("/api/affinity/lists/:id/entries", async (req, res) => {
    try {
      const listId = parseInt(req.params.id);
      console.log(`Fetching entries for list ${listId}`);
      
      // Get all entries for the list
      const entries = await affinityService.getAllListEntries(listId);
      console.log(`Got ${entries.length} entries`);
      res.json(entries);
    } catch (error: any) {
      console.error("Error fetching list entries:", error);
      console.error("Error details:", error.response?.data || error.message);
      console.error("Error status:", error.response?.status);
      res.status(500).json({ 
        error: "Failed to fetch Affinity list entries", 
        details: error.response?.data || error.message,
        status: error.response?.status
      });
    }
  });

  app.get("/api/affinity/lists/:id/entries-enriched", async (req, res) => {
    try {
      const listId = parseInt(req.params.id);
      const entries = await affinityService.getEnrichedListEntries(listId);
      res.json(entries);
    } catch (error: any) {
      console.error("Error fetching enriched list entries:", error.message);
      res.status(500).json({ error: "Failed to fetch enriched Affinity list entries" });
    }
  });

  app.get("/api/affinity/lists/:id/status-options", async (req, res) => {
    try {
      const listId = parseInt(req.params.id);
      
      // Get all entries for the list to extract unique status values
      const entries = await affinityService.getAllListEntries(listId);
      
      // Find the status field first
      const fields = await affinityService.getFields(listId);
      const statusField = fields.find(field => field.name.toLowerCase() === 'status');
      
      if (!statusField) {
        return res.json([]);
      }
      
      // Extract unique status values from entries
      const statusValues = new Set<string>();
      
      for (const entry of entries) {
        if (entry.entity && entry.entity.fields) {
          const statusFieldData = entry.entity.fields.find((field: any) => field.id === statusField.id);
          if (statusFieldData && statusFieldData.value && statusFieldData.value.data && statusFieldData.value.data.text) {
            statusValues.add(statusFieldData.value.data.text);
          }
        }
      }
      
      // Convert to array and sort
      const uniqueStatusOptions = Array.from(statusValues).sort().map((text, index) => ({
        id: `status-${index}`,
        text: text
      }));
      
      res.json(uniqueStatusOptions);
    } catch (error: any) {
      console.error("Error fetching status options:", error.message);
      res.status(500).json({ error: "Failed to fetch status options" });
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

  app.post("/api/notion/databases/:id/properties", async (req, res) => {
    try {
      const { propertyName, propertyType = 'rich_text' } = req.body;
      
      if (!propertyName) {
        return res.status(400).json({ error: "Property name is required" });
      }

      const database = await notionService.addPropertyToDatabase(req.params.id, propertyName, propertyType);
      res.json(database);
    } catch (error) {
      console.error("Error adding property to Notion database:", error);
      res.status(500).json({ error: "Failed to add property to Notion database" });
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
      
      // Get actual running syncs count from sync service
      const activeSyncs = syncService.getActiveSyncCount();
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

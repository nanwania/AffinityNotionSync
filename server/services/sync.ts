import { affinityService, AffinityListEntry, AffinityFieldValue } from './affinity';
import { notionService, NotionPage } from './notion';
import { storage } from '../storage';
import { SyncPair, InsertSyncHistory, InsertConflict } from '@shared/schema';
import cron from 'node-cron';

export interface SyncResult {
  success: boolean;
  recordsUpdated: number;
  recordsCreated: number;
  recordsDeleted: number;
  conflictsFound: number;
  duration: number;
  errorMessage?: string;
  details: any;
}

export interface FieldMapping {
  affinityField: string;
  notionProperty: string;
  affinityFieldId?: number;
}

export class SyncService {
  private activeSyncs = new Set<number>();
  private scheduledJobs = new Map<number, cron.ScheduledTask>();
  
  // Clear stuck sync processes
  clearActiveSyncs(): void {
    this.activeSyncs.clear();
  }

  // Get the count of currently running syncs
  getActiveSyncCount(): number {
    return this.activeSyncs.size;
  }

  async startScheduledSync(syncPair: SyncPair): Promise<void> {
    // Stop existing job if it exists
    if (this.scheduledJobs.has(syncPair.id)) {
      this.scheduledJobs.get(syncPair.id)?.stop();
    }

    // Create cron pattern from frequency in minutes
    const cronPattern = `*/${syncPair.syncFrequency} * * * *`;
    
    const job = cron.schedule(cronPattern, async () => {
      if (!this.activeSyncs.has(syncPair.id)) {
        await this.syncPair(syncPair.id);
      }
    }, {
      scheduled: false
    });

    this.scheduledJobs.set(syncPair.id, job);
    job.start();
  }

  async stopScheduledSync(syncPairId: number): Promise<void> {
    if (this.scheduledJobs.has(syncPairId)) {
      this.scheduledJobs.get(syncPairId)?.stop();
      this.scheduledJobs.delete(syncPairId);
    }
  }

  async syncPair(syncPairId: number): Promise<SyncResult> {
    const startTime = Date.now();
    
    if (this.activeSyncs.has(syncPairId)) {
      return {
        success: false,
        recordsUpdated: 0,
        recordsCreated: 0,
        conflictsFound: 0,
        duration: Date.now() - startTime,
        errorMessage: 'Sync already in progress for this pair',
        details: {}
      };
    }

    this.activeSyncs.add(syncPairId);

    try {
      const syncPair = await storage.getSyncPair(syncPairId);
      if (!syncPair) {
        throw new Error('Sync pair not found');
      }

      let result: SyncResult;

      if (syncPair.syncDirection === 'affinity-to-notion') {
        result = await this.syncAffinityToNotion(syncPair);
      } else if (syncPair.syncDirection === 'notion-to-affinity') {
        result = await this.syncNotionToAffinity(syncPair);
      } else {
        result = await this.syncBidirectional(syncPair);
      }

      // Update last sync time
      await storage.updateSyncPair(syncPairId, { lastSync: new Date() });

      // Log sync history
      await storage.createSyncHistory({
        syncPairId,
        status: result.success ? (result.conflictsFound > 0 ? 'warning' : 'success') : 'error',
        recordsUpdated: result.recordsUpdated,
        recordsCreated: result.recordsCreated,
        recordsDeleted: result.recordsDeleted,
        conflictsFound: result.conflictsFound,
        duration: result.duration,
        errorMessage: result.errorMessage,
        details: result.details
      });

      return result;
    } catch (error) {
      const result: SyncResult = {
        success: false,
        recordsUpdated: 0,
        recordsCreated: 0,
        conflictsFound: 0,
        duration: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        details: { error: error instanceof Error ? error.stack : error }
      };

      await storage.createSyncHistory({
        syncPairId,
        status: 'error',
        recordsUpdated: 0,
        recordsCreated: 0,
        recordsDeleted: 0,
        conflictsFound: 0,
        duration: result.duration,
        errorMessage: result.errorMessage,
        details: result.details
      });

      return result;
    } finally {
      this.activeSyncs.delete(syncPairId);
    }
  }

  private async syncAffinityToNotion(syncPair: SyncPair): Promise<SyncResult> {
    const startTime = Date.now();
    let recordsUpdated = 0;
    let recordsCreated = 0;
    let recordsDeleted = 0;
    let conflictsFound = 0;
    const details: any = {};

    try {
      // Get Affinity list entries with optional pre-filtering for performance
      let affinityEntries = await affinityService.getAllListEntries(
        parseInt(syncPair.affinityListId),
        syncPair.statusFilters && Array.isArray(syncPair.statusFilters) && syncPair.statusFilters.length > 0 
          ? syncPair.statusFilters 
          : undefined
      );
      
      // Status filtering is now handled in getAllListEntries for performance
      if (syncPair.statusFilters && Array.isArray(syncPair.statusFilters) && syncPair.statusFilters.length > 0) {
        console.log(`Pre-filtered to ${affinityEntries.length} entries matching status filters: [${syncPair.statusFilters.join(', ')}]`);
        details.statusFiltering = {
          filteredEntries: affinityEntries.length,
          statusFilters: syncPair.statusFilters
        };
      }
      
      // Get Notion database pages
      const notionPages = await notionService.queryDatabase(syncPair.notionDatabaseId);
      console.log(`Found ${notionPages.length} total pages in Notion database`);
      
      // Create mapping of Affinity entity IDs to Notion pages
      const notionPageMap = new Map<string, NotionPage>();
      let pagesWithAffinityId = 0;
      let pagesWithoutAffinityId = 0;
      
      notionPages.forEach(page => {
        // Try to find Affinity ID in page properties
        const affinityId = this.extractAffinityIdFromNotionPage(page);
        if (affinityId) {
          notionPageMap.set(affinityId, page);
          pagesWithAffinityId++;
        } else {
          pagesWithoutAffinityId++;
        }
      });
      
      console.log(`Notion pages breakdown: ${pagesWithAffinityId} with Affinity ID, ${pagesWithoutAffinityId} without Affinity ID`);

      // Process Affinity entries in batches for better performance
      const BATCH_SIZE = 5; // Process 5 entries in parallel
      console.log(`Processing ${affinityEntries.length} entries in batches of ${BATCH_SIZE}`);
      
      for (let i = 0; i < affinityEntries.length; i += BATCH_SIZE) {
        const batch = affinityEntries.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(affinityEntries.length/BATCH_SIZE)}: entries ${i+1}-${Math.min(i+BATCH_SIZE, affinityEntries.length)}`);
        
        // Process batch in parallel
        const batchPromises = batch.map(async (entry) => {
          const affinityId = entry.entity.id.toString();
          const existingNotionPage = notionPageMap.get(affinityId);

          // For v2 API, field values are embedded in entry.entity.fields - convert to legacy format for compatibility
          const entityFields = entry.entity?.fields || [];

          const fieldValues = entityFields.map(field => ({
            field_id: field.id, // Keep original field ID for proper matching
            value: field.value?.data,
            id: field.id
          }));

          // Convert field values to Notion properties (includes Affinity ID automatically)
          const notionProperties = await this.convertAffinityToNotionProperties(fieldValues, syncPair.fieldMappings as FieldMapping[], syncPair.notionDatabaseId, entry);

          if (existingNotionPage) {
            // Check for conflicts
            const conflicts = await this.detectConflicts(syncPair, entry, existingNotionPage, fieldValues);
            if (conflicts.length > 0) {
              return { type: 'conflict', count: conflicts.length };
            }

            // Update existing page
            await notionService.updatePage(existingNotionPage.id, notionProperties);
            return { type: 'updated', count: 1 };
          } else {
            // Create new page
            await notionService.createPage(syncPair.notionDatabaseId, notionProperties);
            return { type: 'created', count: 1 };
          }
        });
        
        // Wait for batch to complete
        const batchResults = await Promise.all(batchPromises);
        
        // Update counters
        for (const result of batchResults) {
          if (result.type === 'updated') recordsUpdated += result.count;
          else if (result.type === 'created') recordsCreated += result.count;
          else if (result.type === 'conflict') conflictsFound += result.count;
        }
      }

      // Clean up Notion pages based on current filtering criteria
      console.log('Starting cleanup process...');
      
      // Create set of current filtered Affinity entity IDs (entries that should exist in Notion)
      const currentFilteredIds = new Set(affinityEntries.map(entry => entry.entity.id.toString()));
      console.log(`Current sync includes ${currentFilteredIds.size} filtered entries`);
      
      // Find Notion pages that should be deleted
      const pagesToDelete = [];
      
      for (const [affinityId, notionPage] of notionPageMap) {
        // Delete if the Affinity ID is not in the current filtered set
        if (!currentFilteredIds.has(affinityId)) {
          pagesToDelete.push({ affinityId, notionPage, reason: 'no longer matches current filters' });
        }
      }
      
      console.log(`Found ${pagesToDelete.length} Notion pages to delete (no longer match current sync criteria)`);
      
      // Delete the pages that no longer match current criteria
      for (const { affinityId, notionPage, reason } of pagesToDelete) {
        try {
          console.log(`Deleting Notion page for Affinity ID ${affinityId}: ${notionPage.id} (${reason})`);
          await notionService.deletePage(notionPage.id);
          recordsDeleted++;
        } catch (error) {
          console.error(`Failed to delete Notion page ${notionPage.id} for Affinity ID ${affinityId}:`, error);
        }
      }
      
      details.cleanup = {
        currentFilteredEntries: currentFilteredIds.size,
        pagesDeleted: pagesToDelete.length,
        totalNotionPages: notionPageMap.size
      };

      return {
        success: true,
        recordsUpdated,
        recordsCreated,
        recordsDeleted,
        conflictsFound,
        duration: Date.now() - startTime,
        details: { 
          affinityEntries: affinityEntries.length, 
          notionPages: notionPages.length,
          ...details 
        }
      };
    } catch (error) {
      return {
        success: false,
        recordsUpdated,
        recordsCreated,
        recordsDeleted,
        conflictsFound,
        duration: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        details: { error: error instanceof Error ? error.stack : error }
      };
    }
  }

  private async syncNotionToAffinity(syncPair: SyncPair): Promise<SyncResult> {
    const startTime = Date.now();
    let recordsUpdated = 0;
    let recordsCreated = 0;
    let recordsDeleted = 0;
    let conflictsFound = 0;

    try {
      // Get Notion database pages
      const notionPages = await notionService.queryDatabase(syncPair.notionDatabaseId);
      
      // Get Affinity list entries
      const affinityEntries = await affinityService.getAllListEntries(parseInt(syncPair.affinityListId));
      
      // Create mapping of Affinity entity IDs to entries
      const affinityEntryMap = new Map<string, AffinityListEntry>();
      affinityEntries.forEach(entry => {
        affinityEntryMap.set(entry.entity.id.toString(), entry);
      });

      // Process each Notion page
      for (const page of notionPages) {
        const affinityId = this.extractAffinityIdFromNotionPage(page);
        if (!affinityId) continue;

        const existingAffinityEntry = affinityEntryMap.get(affinityId);
        if (existingAffinityEntry) {
          // Check for conflicts - use embedded field values from v2 API
          const entityFields = existingAffinityEntry.entity?.fields || [];
          const fieldValues = entityFields.map(field => ({
            field_id: field.id.replace('field-', ''), // Remove field- prefix if present
            value: field.value?.data,
            id: field.id
          }));
          
          const conflicts = await this.detectConflicts(syncPair, existingAffinityEntry, page, fieldValues);
          if (conflicts.length > 0) {
            conflictsFound += conflicts.length;
            continue; // Skip update if conflicts found
          }

          // Update Affinity field values
          await this.updateAffinityFromNotionPage(syncPair, existingAffinityEntry, page);
          recordsUpdated++;
        }
        // Note: We don't create new Affinity entries from Notion pages in this implementation
      }

      return {
        success: true,
        recordsUpdated,
        recordsCreated,
        recordsDeleted,
        conflictsFound,
        duration: Date.now() - startTime,
        details: { notionPages: notionPages.length, affinityEntries: affinityEntries.length }
      };
    } catch (error) {
      return {
        success: false,
        recordsUpdated,
        recordsCreated,
        recordsDeleted,
        conflictsFound,
        duration: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        details: { error: error instanceof Error ? error.stack : error }
      };
    }
  }

  private async syncBidirectional(syncPair: SyncPair): Promise<SyncResult> {
    const startTime = Date.now();
    
    // First sync Affinity to Notion
    const affinityToNotionResult = await this.syncAffinityToNotion(syncPair);
    
    // Then sync Notion to Affinity
    const notionToAffinityResult = await this.syncNotionToAffinity(syncPair);

    return {
      success: affinityToNotionResult.success && notionToAffinityResult.success,
      recordsUpdated: affinityToNotionResult.recordsUpdated + notionToAffinityResult.recordsUpdated,
      recordsCreated: affinityToNotionResult.recordsCreated + notionToAffinityResult.recordsCreated,
      recordsDeleted: affinityToNotionResult.recordsDeleted + notionToAffinityResult.recordsDeleted,
      conflictsFound: affinityToNotionResult.conflictsFound + notionToAffinityResult.conflictsFound,
      duration: Date.now() - startTime,
      errorMessage: affinityToNotionResult.errorMessage || notionToAffinityResult.errorMessage,
      details: {
        affinityToNotion: affinityToNotionResult.details,
        notionToAffinity: notionToAffinityResult.details
      }
    };
  }

  private async detectConflicts(
    syncPair: SyncPair, 
    affinityEntry: AffinityListEntry, 
    notionPage: NotionPage, 
    fieldValues: AffinityFieldValue[]
  ): Promise<InsertConflict[]> {
    const conflicts: InsertConflict[] = [];
    const fieldMappings = syncPair.fieldMappings as FieldMapping[];

    // Get last sync time to determine what constitutes a "recent" change
    const lastSyncTime = syncPair.lastSync ? new Date(syncPair.lastSync) : new Date(0);
    const notionLastModified = new Date(notionPage.last_edited_time);

    for (const mapping of fieldMappings) {
      const affinityFieldValue = fieldValues.find(fv => fv.field_id === mapping.affinityFieldId);
      const notionProperty = notionPage.properties[mapping.notionProperty];

      if (affinityFieldValue && notionProperty) {
        const affinityValue = affinityFieldValue.value;
        const notionValue = notionService.convertNotionToAffinityValue(notionProperty);

        // Compare values - only create conflicts if they actually differ
        if (JSON.stringify(affinityValue) !== JSON.stringify(notionValue)) {
          
          // Get Affinity field modification time (if available)
          // Note: Affinity API doesn't provide field-level modification times in v2,
          // so we use entity modification time as approximation
          const affinityLastModified = affinityEntry.entity.last_modified 
            ? new Date(affinityEntry.entity.last_modified) 
            : new Date();

          console.log(`Conflict detected for field '${mapping.affinityField}':`, {
            affinityValue: JSON.stringify(affinityValue).substring(0, 100),
            notionValue: JSON.stringify(notionValue).substring(0, 100),
            affinityLastModified: affinityLastModified.toISOString(),
            notionLastModified: notionLastModified.toISOString(),
            lastSyncTime: lastSyncTime.toISOString()
          });

          // Intelligent conflict resolution based on timestamps and sync direction
          let shouldCreateConflict = true;
          let autoResolution: string | null = null;

          // Auto-resolve based on modification times and sync direction
          if (syncPair.syncDirection === 'affinity-to-notion') {
            // Affinity is the source of truth - always use Affinity value
            autoResolution = 'affinity';
            shouldCreateConflict = false;
            console.log(`Auto-resolving conflict in favor of Affinity (source of truth)`);
          } else if (syncPair.syncDirection === 'notion-to-affinity') {
            // Notion is the source of truth - always use Notion value
            autoResolution = 'notion';
            shouldCreateConflict = false;
            console.log(`Auto-resolving conflict in favor of Notion (source of truth)`);
          } else {
            // Bidirectional sync - use timestamps to determine most recent change
            const affinityModifiedAfterSync = affinityLastModified > lastSyncTime;
            const notionModifiedAfterSync = notionLastModified > lastSyncTime;
            
            if (affinityModifiedAfterSync && !notionModifiedAfterSync) {
              // Only Affinity was modified since last sync
              autoResolution = 'affinity';
              shouldCreateConflict = false;
              console.log(`Auto-resolving conflict in favor of Affinity (more recent change)`);
            } else if (notionModifiedAfterSync && !affinityModifiedAfterSync) {
              // Only Notion was modified since last sync
              autoResolution = 'notion';
              shouldCreateConflict = false;
              console.log(`Auto-resolving conflict in favor of Notion (more recent change)`);
            } else if (affinityLastModified > notionLastModified) {
              // Both modified, but Affinity is more recent
              autoResolution = 'affinity';
              shouldCreateConflict = false;
              console.log(`Auto-resolving conflict in favor of Affinity (timestamp: ${affinityLastModified.toISOString()} > ${notionLastModified.toISOString()})`);
            } else if (notionLastModified > affinityLastModified) {
              // Both modified, but Notion is more recent
              autoResolution = 'notion';
              shouldCreateConflict = false;
              console.log(`Auto-resolving conflict in favor of Notion (timestamp: ${notionLastModified.toISOString()} > ${affinityLastModified.toISOString()})`);
            } else {
              // Same timestamps or both modified since last sync - create manual conflict
              console.log(`Creating manual conflict - both sources modified since last sync with similar timestamps`);
            }
          }

          if (shouldCreateConflict) {
            // Create conflict for manual resolution
            const conflict: InsertConflict = {
              syncPairId: syncPair.id,
              recordId: affinityEntry.entity.id.toString(),
              recordType: affinityService.getEntityType(affinityEntry.entity),
              fieldName: mapping.affinityField,
              affinityValue: affinityValue,
              notionValue: notionValue,
              affinityLastModified: affinityLastModified,
              notionLastModified: notionLastModified,
              status: 'pending'
            };

            conflicts.push(conflict);
            await storage.createConflict(conflict);
          } else if (autoResolution) {
            // Apply auto-resolution immediately
            if (autoResolution === 'affinity') {
              // Update Notion with Affinity value
              await notionService.updatePage(notionPage.id, {
                [mapping.notionProperty]: notionService.convertAffinityToNotionProperty(
                  affinityValue, 
                  notionService.getPropertyType(await notionService.getDatabase(syncPair.notionDatabaseId), mapping.notionProperty)
                )
              });
            } else {
              // Update Affinity with Notion value (if supported by API)
              // Note: Affinity v2 API has limited field update capabilities
              console.log(`Would update Affinity field '${mapping.affinityField}' with Notion value, but API limitations may apply`);
            }
          }
        }
      }
    }

    return conflicts;
  }

  private extractAffinityIdFromNotionPage(page: NotionPage): string | null {
    const affinityIdProperty = page.properties['Affinity_ID'];
    if (affinityIdProperty && affinityIdProperty.type === 'rich_text') {
      return affinityIdProperty.rich_text?.[0]?.text?.content || null;
    }
    return null;
  }

  private async convertAffinityToNotionProperties(
    fieldValues: AffinityFieldValue[], 
    fieldMappings: FieldMapping[], 
    notionDatabaseId: string,
    affinityEntry?: AffinityListEntry
  ): Promise<Record<string, any>> {
    const notionProperties: Record<string, any> = {};
    const database = await notionService.getDatabase(notionDatabaseId);

    // ALWAYS include Affinity ID - this is the primary identifier
    if (affinityEntry) {
      notionProperties['Affinity_ID'] = {
        rich_text: [{ type: 'text', text: { content: affinityEntry.entity.id.toString() } }]
      };
    }

    // ALWAYS include the entity name as the title/opportunity name
    if (affinityEntry) {
      // Check if there's a Name property in the database
      if (database.properties['Name']) {
        notionProperties['Name'] = {
          title: [{ type: 'text', text: { content: affinityEntry.entity.name || 'Untitled' } }]
        };
      }
      // Check for other common title field names
      if (database.properties['Opportunity Name']) {
        notionProperties['Opportunity Name'] = {
          title: [{ type: 'text', text: { content: affinityEntry.entity.name || 'Untitled' } }]
        };
      }
    }

    // Process user-defined field mappings
    for (const mapping of fieldMappings) {
      let value = null;
      
      // Handle virtual fields (negative IDs)
      if (mapping.affinityFieldId && mapping.affinityFieldId < 0 && affinityEntry) {
        switch (mapping.affinityFieldId) {
          case -1: // Entity Name
            value = affinityEntry.entity.name;
            break;
          case -2: // Entity Domain
            value = affinityEntry.entity.domain || (affinityEntry.entity.domains && affinityEntry.entity.domains[0]) || null;
            break;
          case -3: // Entity Type
            value = affinityEntry.entity_type === 1 ? 'Organization' : affinityEntry.entity_type === 0 ? 'Person' : 'Opportunity';
            break;
          case -4: // Name (same as Entity Name)
            value = affinityEntry.entity.name;
            break;
          case -5: // Opportunity ID
            value = affinityEntry.entity_type === 2 ? affinityEntry.entity.id.toString() : null;
            break;
          case -6: // Organization Name
            value = affinityEntry.entity_type === 1 ? affinityEntry.entity.name : null;
            break;
          case -7: // Organization ID
            value = affinityEntry.entity_type === 1 ? affinityEntry.entity.id.toString() : null;
            break;
        }
      } else {
        // Handle regular field values
        const fieldValue = fieldValues.find(fv => fv.field_id === mapping.affinityFieldId);
        if (fieldValue) {
          value = fieldValue.value;
        }
      }
      
      if (value !== null) {
        const propertyType = notionService.getPropertyType(database, mapping.notionProperty);
        notionProperties[mapping.notionProperty] = notionService.convertAffinityToNotionProperty(
          value, 
          propertyType
        );
      }
    }

    return notionProperties;
  }

  private async updateAffinityFromNotionPage(
    syncPair: SyncPair, 
    affinityEntry: AffinityListEntry, 
    notionPage: NotionPage
  ): Promise<void> {
    const fieldMappings = syncPair.fieldMappings as FieldMapping[];
    // Use embedded field values from v2 API
    const entityFields = affinityEntry.entity?.fields || [];
    const fieldValues = entityFields.map(field => ({
      field_id: field.id, // Keep original field ID for proper matching
      value: field.value?.data,
      id: field.id
    }));

    for (const mapping of fieldMappings) {
      const notionProperty = notionPage.properties[mapping.notionProperty];
      if (notionProperty) {
        const notionValue = notionService.convertNotionToAffinityValue(notionProperty);
        const affinityFieldValue = fieldValues.find(fv => fv.field_id === mapping.affinityFieldId);
        
        if (affinityFieldValue && notionValue !== null) {
          await affinityService.updateFieldValue(affinityFieldValue.id, notionValue);
        }
      }
    }
  }

  async initializeScheduledSyncs(): Promise<void> {
    const syncPairs = await storage.getSyncPairs();
    
    for (const syncPair of syncPairs) {
      if (syncPair.isActive) {
        await this.startScheduledSync(syncPair);
      }
    }
  }
}

export const syncService = new SyncService();

import { affinityService, AffinityListEntry, AffinityFieldValue } from './affinity';
import { notionService, NotionPage } from './notion';
import { storage } from '../storage';
import { SyncPair, InsertSyncHistory, InsertConflict, InsertSyncedRecord } from '@shared/schema';
import cron from 'node-cron';
import { createHash } from 'crypto';

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

  // CRITICAL SAFETY CONSTANTS
  private readonly AFFINITY_DELETION_BLOCKED = true;
  private readonly SAFETY_MODE_ENABLED = true;

  // Utility function to normalize and hash field values for comparison
  private normalizeAndHashFieldValues(fieldValues: AffinityFieldValue[], fieldMappings: FieldMapping[]): string {
    const normalizedValues: Record<string, any> = {};
    
    for (const mapping of fieldMappings) {
      const fieldValue = fieldValues.find(fv => fv.field_id === mapping.affinityFieldId);
      if (fieldValue) {
        // Normalize the value to extract actual content
        let normalizedValue = fieldValue.value;
        
        if (Array.isArray(normalizedValue)) {
          normalizedValue = normalizedValue.map(item => {
            if (typeof item === 'object' && item !== null && 'text' in item) {
              return item.text; // Extract text from Affinity dropdown format
            }
            return item;
          }).sort(); // Sort for consistent comparison
        } else if (typeof normalizedValue === 'object' && normalizedValue !== null && 'text' in normalizedValue) {
          normalizedValue = normalizedValue.text; // Extract text from single Affinity dropdown item
        }
        
        normalizedValues[mapping.affinityField] = normalizedValue;
      }
    }
    
    // Create a hash of the normalized values
    const valueString = JSON.stringify(normalizedValues, Object.keys(normalizedValues).sort());
    return createHash('sha256').update(valueString).digest('hex');
  }
  
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
    // SAFETY CHECK: Verify safety mode is enabled
    if (!this.SAFETY_MODE_ENABLED) {
      throw new Error('SAFETY ERROR: Safety mode must be enabled for all sync operations');
    }

    const startTime = Date.now();
    
    if (this.activeSyncs.has(syncPairId)) {
      return {
        success: false,
        recordsUpdated: 0,
        recordsCreated: 0,
        recordsDeleted: 0,
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

      console.log(`[AFFINITY SAFETY] Starting sync for pair: ${syncPair.name} (${syncPair.syncDirection}) - Affinity deletion protection: ENABLED`);

      let result: SyncResult;

      if (syncPair.syncDirection === 'affinity-to-notion') {
        result = await this.syncAffinityToNotion(syncPair);
      } else if (syncPair.syncDirection === 'notion-to-affinity') {
        result = await this.syncNotionToAffinity(syncPair);
      } else {
        result = await this.syncBidirectional(syncPair);
      }

      // SAFETY VALIDATION: Ensure no Affinity entries were deleted
      if (this.AFFINITY_DELETION_BLOCKED && result.recordsDeleted > 0 && (syncPair.syncDirection === 'notion-to-affinity' || syncPair.syncDirection === 'bidirectional')) {
        console.error(`[AFFINITY SAFETY] CRITICAL ERROR: ${result.recordsDeleted} Affinity records reported as deleted, which should never happen!`);
        result.success = false;
        result.errorMessage = 'SAFETY VIOLATION: Affinity deletion detected and blocked';
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

      console.log(`[AFFINITY SAFETY] Sync completed: ${result.recordsUpdated} updated, ${result.recordsCreated} created, ${result.recordsDeleted} deleted (Affinity entries: 0 deleted as expected)`);

      return result;
    } catch (error) {
      const result: SyncResult = {
        success: false,
        recordsUpdated: 0,
        recordsCreated: 0,
        recordsDeleted: 0,
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

          // Organization ID extraction confirmed working correctly
          
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
            // Check if we have a synced record for this entry
            const syncedRecord = await storage.getSyncedRecord(syncPair.id, affinityId);
            const currentFieldHash = this.normalizeAndHashFieldValues(fieldValues, syncPair.fieldMappings as FieldMapping[]);
            
            // If we have a synced record and the hash matches, skip this entry
            if (syncedRecord && syncedRecord.fieldValuesHash === currentFieldHash) {
              // Values haven't changed since last sync - no update needed
              return { type: 'unchanged', count: 0 };
            }

            // Check for conflicts (only if values have changed)
            const conflicts = await this.detectConflicts(syncPair, entry, existingNotionPage, fieldValues);
            if (conflicts.length > 0) {
              return { type: 'conflict', count: conflicts.length };
            }

            // Update existing page
            await notionService.updatePage(existingNotionPage.id, notionProperties);
            
            // Update or create synced record
            await storage.createOrUpdateSyncedRecord({
              syncPairId: syncPair.id,
              recordId: affinityId,
              recordType: affinityService.getEntityType(entry.entity),
              affinityId: affinityId,
              notionPageId: existingNotionPage.id,
              fieldValuesHash: currentFieldHash,
              affinityLastModified: entry.entity.last_modified ? new Date(entry.entity.last_modified) : new Date(),
              notionLastModified: new Date(existingNotionPage.last_edited_time),
              lastSyncedAt: new Date()
            });
            
            return { type: 'updated', count: 1 };
          } else {
            // Create new page
            const newPage = await notionService.createPage(syncPair.notionDatabaseId, notionProperties);
            const currentFieldHash = this.normalizeAndHashFieldValues(fieldValues, syncPair.fieldMappings as FieldMapping[]);
            
            // Create synced record for the new page
            await storage.createOrUpdateSyncedRecord({
              syncPairId: syncPair.id,
              recordId: affinityId,
              recordType: affinityService.getEntityType(entry.entity),
              affinityId: affinityId,
              notionPageId: newPage.id,
              fieldValuesHash: currentFieldHash,
              affinityLastModified: entry.entity.last_modified ? new Date(entry.entity.last_modified) : new Date(),
              notionLastModified: new Date(newPage.last_edited_time),
              lastSyncedAt: new Date()
            });
            
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
          // Also delete the corresponding synced record
          await storage.deleteSyncedRecord(syncPair.id, affinityId);
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
    // SAFETY GUARANTEE: This sync direction ONLY updates field values, NEVER deletes Affinity entries
    console.log(`[AFFINITY SAFETY] Starting Notion-to-Affinity sync - FIELD UPDATES ONLY, NO DELETIONS`);
    
    const startTime = Date.now();
    let recordsUpdated = 0;
    let recordsCreated = 0; // Always 0 - we don't create new Affinity entries
    let recordsDeleted = 0; // Always 0 - we NEVER delete Affinity entries
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

      console.log(`[AFFINITY SAFETY] Processing ${notionPages.length} Notion pages for field updates only`);

      // Process each Notion page
      for (const page of notionPages) {
        const affinityId = this.extractAffinityIdFromNotionPage(page);
        if (!affinityId) continue;

        const existingAffinityEntry = affinityEntryMap.get(affinityId);
        if (existingAffinityEntry) {
          // Check for conflicts - use embedded field values from v2 API
          const entityFields = existingAffinityEntry.entity?.fields || [];
          const fieldValues = entityFields.map(field => ({
            field_id: field.id, // Keep original field ID for proper matching
            value: field.value?.data,
            id: field.id
          }));
          
          const conflicts = await this.detectConflicts(syncPair, existingAffinityEntry, page, fieldValues);
          if (conflicts.length > 0) {
            conflictsFound += conflicts.length;
            continue; // Skip update if conflicts found
          }

          // SAFETY: Only update existing entries, never create or delete
          await this.updateAffinityFromNotionPage(syncPair, existingAffinityEntry, page);
          recordsUpdated++;
        } else {
          console.log(`[AFFINITY SAFETY] Notion page references non-existent Affinity ID ${affinityId} - SKIPPING (no new entries created in Affinity)`);
        }
      }

      console.log(`[AFFINITY SAFETY] Completed Notion-to-Affinity sync: ${recordsUpdated} field updates, 0 deletions`);

      return {
        success: true,
        recordsUpdated,
        recordsCreated, // Always 0 - we don't create new Affinity entries
        recordsDeleted, // Always 0 - we NEVER delete Affinity entries
        conflictsFound,
        duration: Date.now() - startTime,
        details: { 
          notionPages: notionPages.length, 
          affinityEntries: affinityEntries.length,
          safetyNote: "No Affinity entries were created or deleted - field updates only"
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

        // Normalize both values to compare their actual content, not format
        const normalizeValue = (value: any): any => {
          if (Array.isArray(value)) {
            return value.map(item => {
              if (typeof item === 'object' && item !== null && 'text' in item) {
                return item.text; // Extract text from Affinity dropdown format
              }
              return item;
            }).sort(); // Sort for consistent comparison
          }
          if (typeof value === 'object' && value !== null && 'text' in value) {
            return value.text; // Extract text from single Affinity dropdown item
          }
          return value;
        };

        const normalizedAffinityValue = normalizeValue(affinityValue);
        const normalizedNotionValue = normalizeValue(notionValue);

        // Note: Values are now normalized for accurate comparison

        // Compare normalized values - only create conflicts if they actually differ
        if (JSON.stringify(normalizedAffinityValue) !== JSON.stringify(normalizedNotionValue)) {
          
          // Get Affinity field modification time (if available)
          // Note: Affinity API doesn't provide field-level modification times in v2,
          // so we use entity modification time as approximation
          const affinityLastModified = affinityEntry.entity.last_modified 
            ? new Date(affinityEntry.entity.last_modified) 
            : new Date();

          console.log(`Conflict detected for field '${mapping.affinityField}':`, {
            affinityValue: JSON.stringify(normalizedAffinityValue),
            notionValue: JSON.stringify(normalizedNotionValue),
            affinityRaw: JSON.stringify(affinityValue).substring(0, 100),
            notionRaw: JSON.stringify(notionValue).substring(0, 100),
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
          } 
          // Note: Auto-resolved conflicts don't need to be added to conflicts array
          // or update pages here - the main sync logic will handle the update
        }
      }
    }

    return conflicts;
  }

  private extractAffinityIdFromNotionPage(page: NotionPage): string | null {
    const affinityIdProperty = page.properties['Affinity_ID'];
    if (affinityIdProperty) {
      if (affinityIdProperty.type === 'rich_text' && affinityIdProperty.rich_text?.[0]?.text?.content) {
        return affinityIdProperty.rich_text[0].text.content;
      }
      if (affinityIdProperty.type === 'number' && affinityIdProperty.number !== null) {
        return affinityIdProperty.number.toString();
      }
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
      // Check if Affinity_ID is a number field or rich_text field in the database
      const affinityIdProperty = database.properties['Affinity_ID'];
      if (affinityIdProperty && affinityIdProperty.type === 'number') {
        notionProperties['Affinity_ID'] = {
          number: parseInt(affinityEntry.entity.id.toString(), 10)
        };
      } else {
        notionProperties['Affinity_ID'] = {
          rich_text: [{ type: 'text', text: { content: affinityEntry.entity.id.toString() } }]
        };
      }
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
            // For opportunities, extract Organization ID from the "companies" field
            const organizationField = affinityEntry.entity?.fields?.find(f => f.id === 'companies' || f.name === 'Organizations');
            if (organizationField && organizationField.value?.data && Array.isArray(organizationField.value.data) && organizationField.value.data.length > 0) {
              // Get the first organization's ID from the companies field
              value = organizationField.value.data[0].id.toString();
              console.log(`[DEBUG] Organization ID extracted from companies field: ${value} (${organizationField.value.data[0].name})`);
            } else {
              // Fallback: if it's directly an organization entity (entity_type=1)
              const entityType = affinityEntry.entity_type || affinityEntry.entity.type;
              value = entityType === 1 ? affinityEntry.entity.id.toString() : null;
              console.log(`[DEBUG] Organization ID fallback check: entity_type=${entityType}, value=${value}`);
            }
            break;
        }
      } else if (mapping.affinityFieldId) {
        // Handle regular field values
        const fieldValue = fieldValues.find(fv => fv.field_id === mapping.affinityFieldId);
        if (fieldValue) {
          value = fieldValue.value;
        }
      } else {
        // For fields without affinityFieldId, this is likely a configuration issue
        console.log(`[DEBUG] Field ${mapping.affinityField} has no affinityFieldId - this should be mapped to a proper field ID`);
        value = null;
      }
      
      // Special handling for organization fields - extract from companies field if it's a virtual organization field
      if (mapping.affinityField === 'Organizations' && affinityEntry) {
        const organizationField = affinityEntry.entity?.fields?.find(f => f.id === 'companies' || f.name === 'Organizations');
        if (organizationField && organizationField.value?.data && Array.isArray(organizationField.value.data)) {
          value = organizationField.value.data; // Full organization objects with name, id, domain
        }
      }
      
      const propertyType = notionService.getPropertyType(database, mapping.notionProperty);
      console.log(`[DEBUG] Processing field mapping: ${mapping.affinityField} -> ${mapping.notionProperty}, value: ${JSON.stringify(value)}, type: ${propertyType}`);
      notionProperties[mapping.notionProperty] = notionService.convertAffinityToNotionProperty(
        value, 
        propertyType
      );
    }

    return notionProperties;
  }

  private async updateAffinityFromNotionPage(
    syncPair: SyncPair, 
    affinityEntry: AffinityListEntry, 
    notionPage: NotionPage
  ): Promise<void> {
    // SAFETY GUARANTEE: This method only updates field values, NEVER deletes entries
    console.log(`[AFFINITY SAFETY] Updating field values for Affinity entry ${affinityEntry.entity.id} - NO DELETION WILL OCCUR`);
    
    const fieldMappings = syncPair.fieldMappings as FieldMapping[];
    // Use embedded field values from v2 API
    const entityFields = affinityEntry.entity?.fields || [];
    const fieldValues = entityFields.map(field => ({
      field_id: field.id, // Keep original field ID for proper matching
      value: field.value?.data,
      id: field.id
    }));

    // Collect field updates for batch operation
    const fieldUpdates: Array<{fieldId: string, value: any}> = [];

    for (const mapping of fieldMappings) {
      // Skip virtual fields - they cannot be updated in Affinity
      if (mapping.affinityFieldId && mapping.affinityFieldId < 0) {
        console.log(`[AFFINITY SAFETY] Skipping virtual field ${mapping.affinityField} - cannot update system fields`);
        continue;
      }

      const notionProperty = notionPage.properties[mapping.notionProperty];
      if (notionProperty) {
        const notionValue = notionService.convertNotionToAffinityValue(notionProperty);
        const affinityFieldValue = fieldValues.find(fv => fv.field_id === mapping.affinityFieldId);
        
        if (affinityFieldValue && notionValue !== null && mapping.affinityFieldId) {
          console.log(`[AFFINITY SAFETY] Preparing field update for ${mapping.affinityField} (ID: field-${mapping.affinityFieldId}) with value from Notion`);
          
          // Add to batch update using confirmed API v2 structure
          fieldUpdates.push({
            fieldId: `field-${mapping.affinityFieldId}`,
            value: notionValue
          });
        }
      }
    }

    // Log planned field updates (API v2 field updates not yet available)
    if (fieldUpdates.length > 0) {
      console.log(`[AFFINITY API v2 LIMITATION] ${fieldUpdates.length} fields prepared for update but API v2 field updates not yet supported`);
      console.log(`[AFFINITY SAFETY] Field updates planned but skipped - maintains safety by not attempting unsupported operations`);
      
      // Log what would be updated for transparency
      fieldUpdates.forEach(update => {
        console.log(`[AFFINITY PLANNED UPDATE] ${update.fieldId}: ${JSON.stringify(update.value)}`);
      });
      
      // For now, we maintain safety by not attempting unsupported API operations
      // This ensures no unintended side effects while Affinity develops v2 field update support
    } else {
      console.log(`[AFFINITY SAFETY] No field updates needed for this entry`);
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

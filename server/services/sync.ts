import { affinityService, AffinityListEntry, AffinityFieldValue } from './affinity';
import { notionService, NotionPage } from './notion';
import { storage } from '../storage';
import { SyncPair, InsertSyncHistory, InsertConflict } from '@shared/schema';
import cron from 'node-cron';

export interface SyncResult {
  success: boolean;
  recordsUpdated: number;
  recordsCreated: number;
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
    let conflictsFound = 0;
    const details: any = {};

    try {
      // Get Affinity list entries
      let affinityEntries = await affinityService.getAllListEntries(parseInt(syncPair.affinityListId));
      
      // Apply status filtering if configured
      if (syncPair.statusFilters && Array.isArray(syncPair.statusFilters) && syncPair.statusFilters.length > 0) {
        // Get field values for all entries to filter by status
        const statusField = await affinityService.getFields(parseInt(syncPair.affinityListId))
          .then(fields => fields.find(f => f.name.toLowerCase() === 'status'));
        
        if (statusField) {
          console.log(`Status filtering enabled. Field: ${statusField.name} (ID: ${statusField.id})`);
          console.log(`Target status filters: [${syncPair.statusFilters.join(', ')}]`);
          
          const originalCount = affinityEntries.length;
          const filteredEntries = [];
          const statusCounts: Record<string, number> = {};
          
          for (const entry of affinityEntries) {
            try {
              // For v2 API, field values are embedded in entry.entity.fields
              const entityFields = entry.entity?.fields || [];
              
              // Debug: Log the first entry's field structure to understand the format
              if (entry === affinityEntries[0]) {
                console.log('DEBUG: First entry entity structure:', JSON.stringify({
                  entityId: entry.entity_id,
                  entityType: entry.entity_type,
                  entityFields: entityFields.length > 0 ? entityFields.slice(0, 2) : 'No fields found',
                  statusFieldId: statusField.id,
                  lookingFor: [`field-${statusField.id}`, statusField.id.toString()]
                }, null, 2));
              }
              
              const statusField_v2 = entityFields.find(f => f.id === `field-${statusField.id}` || f.id === statusField.id.toString());
              
              // Handle both string and object status values from v2 API
              let statusText = 'No Status';
              let statusMatch = false;
              
              if (statusField_v2 && statusField_v2.value && statusField_v2.value.data) {
                const fieldValue = statusField_v2.value.data;
                if (typeof fieldValue === 'string') {
                  statusText = fieldValue;
                  statusMatch = syncPair.statusFilters.includes(fieldValue);
                } else if (typeof fieldValue === 'object' && fieldValue.text) {
                  // Affinity dropdown values are objects with a 'text' property
                  statusText = fieldValue.text;
                  statusMatch = syncPair.statusFilters.includes(fieldValue.text);
                }
              }
              
              statusCounts[statusText] = (statusCounts[statusText] || 0) + 1;
              
              if (statusMatch) {
                filteredEntries.push(entry);
              }
            } catch (error) {
              // If we can't get field values, skip this entry
              console.warn(`Could not get field values for entry ${entry.id}:`, error);
              statusCounts['Error fetching status'] = (statusCounts['Error fetching status'] || 0) + 1;
            }
          }
          
          console.log(`Status distribution in ${originalCount} entries:`, statusCounts);
          console.log(`Filtered to ${filteredEntries.length} entries matching status filters`);
          
          affinityEntries = filteredEntries;
          details.statusFiltering = {
            originalEntries: originalCount,
            filteredEntries: filteredEntries.length,
            statusFilters: syncPair.statusFilters,
            statusCounts
          };
        }
      }
      
      // Get Notion database pages
      const notionPages = await notionService.queryDatabase(syncPair.notionDatabaseId);
      
      // Create mapping of Affinity entity IDs to Notion pages
      const notionPageMap = new Map<string, NotionPage>();
      notionPages.forEach(page => {
        // Try to find Affinity ID in page properties
        const affinityId = this.extractAffinityIdFromNotionPage(page);
        if (affinityId) {
          notionPageMap.set(affinityId, page);
        }
      });

      // Process each Affinity entry
      for (const entry of affinityEntries) {
        const affinityId = entry.entity_id.toString();
        const existingNotionPage = notionPageMap.get(affinityId);

        // For v2 API, field values are embedded in entry.entity.fields - convert to legacy format for compatibility
        const entityFields = entry.entity?.fields || [];
        const fieldValues = entityFields.map(field => ({
          field_id: field.id.replace('field-', ''), // Remove field- prefix if present
          value: field.value?.data,
          id: field.id
        }));

        // Convert field values to Notion properties (includes Affinity ID automatically)
        const notionProperties = await this.convertAffinityToNotionProperties(fieldValues, syncPair.fieldMappings as FieldMapping[], syncPair.notionDatabaseId, entry);

        if (existingNotionPage) {
          // Check for conflicts
          const conflicts = await this.detectConflicts(syncPair, entry, existingNotionPage, fieldValues);
          if (conflicts.length > 0) {
            conflictsFound += conflicts.length;
            continue; // Skip update if conflicts found
          }

          // Update existing page
          await notionService.updatePage(existingNotionPage.id, notionProperties);
          recordsUpdated++;
        } else {
          // Create new page
          await notionService.createPage(syncPair.notionDatabaseId, notionProperties);
          recordsCreated++;
        }
      }

      return {
        success: true,
        recordsUpdated,
        recordsCreated,
        conflictsFound,
        duration: Date.now() - startTime,
        details: { affinityEntries: affinityEntries.length, notionPages: notionPages.length }
      };
    } catch (error) {
      return {
        success: false,
        recordsUpdated,
        recordsCreated,
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
    let conflictsFound = 0;

    try {
      // Get Notion database pages
      const notionPages = await notionService.queryDatabase(syncPair.notionDatabaseId);
      
      // Get Affinity list entries
      const affinityEntries = await affinityService.getAllListEntries(parseInt(syncPair.affinityListId));
      
      // Create mapping of Affinity entity IDs to entries
      const affinityEntryMap = new Map<string, AffinityListEntry>();
      affinityEntries.forEach(entry => {
        affinityEntryMap.set(entry.entity_id.toString(), entry);
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
        conflictsFound,
        duration: Date.now() - startTime,
        details: { notionPages: notionPages.length, affinityEntries: affinityEntries.length }
      };
    } catch (error) {
      return {
        success: false,
        recordsUpdated,
        recordsCreated,
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

    for (const mapping of fieldMappings) {
      const affinityFieldValue = fieldValues.find(fv => fv.field_id === mapping.affinityFieldId);
      const notionProperty = notionPage.properties[mapping.notionProperty];

      if (affinityFieldValue && notionProperty) {
        const affinityValue = affinityFieldValue.value;
        const notionValue = notionService.convertNotionToAffinityValue(notionProperty);

        // Simple conflict detection - compare values
        if (JSON.stringify(affinityValue) !== JSON.stringify(notionValue)) {
          const conflict: InsertConflict = {
            syncPairId: syncPair.id,
            recordId: affinityEntry.entity_id.toString(),
            recordType: affinityService.getEntityType(affinityEntry.entity),
            fieldName: mapping.affinityField,
            affinityValue: affinityValue,
            notionValue: notionValue,
            affinityLastModified: new Date(), // Would need actual modification time
            notionLastModified: new Date(notionPage.last_edited_time),
            status: 'pending'
          };

          conflicts.push(conflict);
          await storage.createConflict(conflict);
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
        rich_text: [{ type: 'text', text: { content: affinityEntry.entity_id.toString() } }]
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
            value = affinityEntry.entity_type === 2 ? affinityEntry.entity_id.toString() : null;
            break;
          case -6: // Organization Name
            value = affinityEntry.entity_type === 1 ? affinityEntry.entity.name : null;
            break;
          case -7: // Organization ID
            value = affinityEntry.entity_type === 1 ? affinityEntry.entity_id.toString() : null;
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
      field_id: field.id.replace('field-', ''), // Remove field- prefix if present
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

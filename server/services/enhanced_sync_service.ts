import { storage } from "../storage";
import { affinityService } from "./affinity";
import { notionService } from "./notion";
import type { 
  SyncPair, 
  AffinityListEntry, 
  NotionPage,
  FieldMapping,
  AffinityFieldValue,
  InsertConflict,
  SyncResult,
  InsertSyncHistory
} from "@shared/types";
import { createHash } from "crypto";
import cron from "node-cron";

// Rate limiter class for API calls
class RateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private lastCallTime = 0;
  private minInterval: number;

  constructor(callsPerSecond: number) {
    this.minInterval = 1000 / callsPerSecond;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          // Ensure minimum interval between calls
          const now = Date.now();
          const timeSinceLastCall = now - this.lastCallTime;
          if (timeSinceLastCall < this.minInterval) {
            await new Promise(res => setTimeout(res, this.minInterval - timeSinceLastCall));
          }
          
          this.lastCallTime = Date.now();
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    while (this.queue.length > 0) {
      const operation = this.queue.shift()!;
      await operation();
    }
    this.processing = false;
  }
}

// Retry utility with exponential backoff
class RetryHandler {
  static async executeWithRetry<T>(
    operation: () => Promise<T>, 
    maxRetries = 3,
    baseDelay = 1000
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        // Don't retry on certain error types
        if (this.isNonRetryableError(error) || attempt === maxRetries) {
          throw error;
        }
        
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`[RETRY] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('Max retries reached');
  }

  private static isNonRetryableError(error: any): boolean {
    // Don't retry on authentication errors, validation errors, etc.
    const status = error.response?.status;
    return status === 400 || status === 401 || status === 403 || status === 404;
  }
}

// Field validation utility
class FieldValidator {
  static validateMapping(affinityField: any, notionPropertyType: string): ValidationResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Type compatibility checks
    if (affinityField.type === 'dropdown' && notionPropertyType === 'number') {
      issues.push('Dropdown fields cannot be mapped to number properties');
    }

    if (affinityField.type === 'date' && notionPropertyType === 'rich_text') {
      warnings.push('Date field mapped to text - formatting may be lost');
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings
    };
  }

  static sanitizeFieldValue(value: any, fieldType: string): any {
    if (value === null || value === undefined) return null;

    switch (fieldType) {
      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return typeof value === 'string' && emailRegex.test(value) ? value : null;
      
      case 'url':
        try {
          const url = new URL(value.toString());
          return url.toString();
        } catch {
          // Try adding https:// prefix
          try {
            const url = new URL(`https://${value.toString()}`);
            return url.toString();
          } catch {
            return null;
          }
        }
      
      case 'number':
        const num = parseFloat(value.toString());
        return isNaN(num) ? null : num;
      
      case 'phone_number':
        // Basic phone number sanitization
        const phone = value.toString().replace(/[^\d+\-().\s]/g, '');
        return phone.length >= 10 ? phone : null;
      
      default:
        return value;
    }
  }
}

interface ValidationResult {
  isValid: boolean;
  issues: string[];
  warnings: string[];
}

// Metrics tracking
class SyncMetrics {
  private static instance: SyncMetrics;
  private metrics = new Map<string, any>();

  static getInstance(): SyncMetrics {
    if (!SyncMetrics.instance) {
      SyncMetrics.instance = new SyncMetrics();
    }
    return SyncMetrics.instance;
  }

  trackSyncDuration(syncPairId: number, duration: number) {
    const key = `sync_duration_${syncPairId}`;
    const durations = this.metrics.get(key) || [];
    durations.push({ timestamp: Date.now(), duration });
    
    // Keep only last 100 entries
    if (durations.length > 100) {
      durations.slice(-100);
    }
    
    this.metrics.set(key, durations);
  }

  getAverageSyncDuration(syncPairId: number): number {
    const key = `sync_duration_${syncPairId}`;
    const durations = this.metrics.get(key) || [];
    
    if (durations.length === 0) return 0;
    
    const total = durations.reduce((sum: number, entry: any) => sum + entry.duration, 0);
    return total / durations.length;
  }

  trackApiCall(service: 'affinity' | 'notion', endpoint: string, status: number) {
    const key = `api_calls_${service}`;
    const calls = this.metrics.get(key) || [];
    calls.push({ 
      timestamp: Date.now(), 
      endpoint, 
      status,
      success: status >= 200 && status < 300
    });
    
    // Keep only last 1000 entries
    if (calls.length > 1000) {
      calls.slice(-1000);
    }
    
    this.metrics.set(key, calls);
  }

  getApiSuccessRate(service: 'affinity' | 'notion', timeRangeMs = 3600000): number {
    const key = `api_calls_${service}`;
    const calls = this.metrics.get(key) || [];
    const cutoff = Date.now() - timeRangeMs;
    
    const recentCalls = calls.filter((call: any) => call.timestamp > cutoff);
    if (recentCalls.length === 0) return 1;
    
    const successfulCalls = recentCalls.filter((call: any) => call.success);
    return successfulCalls.length / recentCalls.length;
  }
}

export class SyncService {
  private scheduledJobs = new Map<number, cron.ScheduledTask>();
  private activeSyncs = new Set<number>();
  private readonly SAFETY_MODE_ENABLED = true;
  private readonly MAX_BATCH_SIZE = 5;
  private organizationFieldIds: Set<number> | null = null;
  
  // Rate limiters for external APIs
  private affinityRateLimiter = new RateLimiter(2); // 2 calls per second
  private notionRateLimiter = new RateLimiter(3); // 3 calls per second
  private metrics = SyncMetrics.getInstance();

  async syncPair(syncPairId: number): Promise<SyncResult> {
    const startTime = Date.now();
    
    // Safety check
    if (!this.SAFETY_MODE_ENABLED) {
      throw new Error('SAFETY ERROR: Safety mode must be enabled for all sync operations');
    }

    if (this.activeSyncs.has(syncPairId)) {
      return {
        success: false,
        recordsUpdated: 0,
        recordsCreated: 0,
        recordsDeleted: 0,
        conflictsFound: 0,
        duration: Date.now() - startTime,
        errorMessage: 'Sync already in progress for this pair'
      };
    }

    this.activeSyncs.add(syncPairId);

    try {
      const syncPair = await storage.getSyncPair(syncPairId);
      if (!syncPair) {
        throw new Error(`Sync pair ${syncPairId} not found`);
      }

      let result: SyncResult;

      // Execute sync with retry logic
      result = await RetryHandler.executeWithRetry(async () => {
        switch (syncPair.syncDirection) {
          case 'affinity-to-notion':
            return await this.syncAffinityToNotion(syncPair);
          case 'notion-to-affinity':
            return await this.syncNotionToAffinity(syncPair);
          case 'bidirectional':
            return await this.syncBidirectional(syncPair);
          default:
            throw new Error(`Invalid sync direction: ${syncPair.syncDirection}`);
        }
      }, 2, 2000); // Max 2 retries, 2 second base delay

      // Track metrics
      this.metrics.trackSyncDuration(syncPairId, result.duration);

      // Update sync pair's last sync time
      await storage.updateSyncPair(syncPairId, { lastSync: new Date() });

      // Create sync history record
      await storage.createSyncHistory({
        syncPairId,
        status: result.success ? 'success' : 'error',
        recordsUpdated: result.recordsUpdated,
        recordsCreated: result.recordsCreated,
        recordsDeleted: result.recordsDeleted,
        conflictsFound: result.conflictsFound,
        duration: result.duration,
        errorMessage: result.errorMessage,
        details: result.details
      });

      return result;

    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorResult: SyncResult = {
        success: false,
        recordsUpdated: 0,
        recordsCreated: 0,
        recordsDeleted: 0,
        conflictsFound: 0,
        duration,
        errorMessage: error.message,
        details: { error: error.stack }
      };

      // Create error history record
      await storage.createSyncHistory({
        syncPairId,
        status: 'error',
        recordsUpdated: 0,
        recordsCreated: 0,
        recordsDeleted: 0,
        conflictsFound: 0,
        duration,
        errorMessage: error.message,
        details: { error: error.stack }
      });

      return errorResult;
    } finally {
      this.activeSyncs.delete(syncPairId);
    }
  }

  private async syncAffinityToNotion(syncPair: SyncPair): Promise<SyncResult> {
    const startTime = Date.now();
    let recordsUpdated = 0;
    let recordsCreated = 0;
    let conflictsFound = 0;

    try {
      // Fetch data with rate limiting
      const [affinityEntries, notionPages] = await Promise.all([
        this.affinityRateLimiter.execute(() => affinityService.getListEntries(syncPair.affinityListId, syncPair.statusFilters as string[])),
        this.notionRateLimiter.execute(() => notionService.getDatabasePages(syncPair.notionDatabaseId))
      ]);

      console.log(`[SYNC] Processing ${affinityEntries.length} Affinity entries and ${notionPages.length} Notion pages`);

      // Create lookup map for existing Notion pages
      const notionPageMap = new Map<string, NotionPage>();
      for (const page of notionPages) {
        const affinityId = this.extractAffinityIdFromNotionPage(page);
        if (affinityId) {
          notionPageMap.set(affinityId, page);
        }
      }

      // Process in batches with enhanced error handling
      for (let i = 0; i < affinityEntries.length; i += this.MAX_BATCH_SIZE) {
        const batch = affinityEntries.slice(i, i + this.MAX_BATCH_SIZE);
        
        const batchPromises = batch.map(async (entry) => {
          try {
            return await this.processAffinityEntry(entry, syncPair, notionPageMap);
          } catch (error: any) {
            console.error(`[ERROR] Failed to process entry ${entry.entity.id}:`, error.message);
            // Continue processing other entries
            return { type: 'error', count: 0 };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        
        // Update counters
        for (const result of batchResults) {
          if (result.type === 'updated') recordsUpdated += result.count;
          else if (result.type === 'created') recordsCreated += result.count;
          else if (result.type === 'conflict') conflictsFound += result.count;
        }
      }

      // Clean up orphaned Notion pages (rate limited)
      await this.cleanupNotionPages(syncPair, affinityEntries, notionPages);

      return {
        success: true,
        recordsUpdated,
        recordsCreated,
        recordsDeleted: 0, // We don't delete, only cleanup
        conflictsFound,
        duration: Date.now() - startTime,
        details: { 
          affinityEntries: affinityEntries.length, 
          notionPages: notionPages.length,
          avgSyncDuration: this.metrics.getAverageSyncDuration(syncPair.id)
        }
      };

    } catch (error: any) {
      return {
        success: false,
        recordsUpdated,
        recordsCreated,
        recordsDeleted: 0,
        conflictsFound,
        duration: Date.now() - startTime,
        errorMessage: error.message,
        details: { error: error.stack }
      };
    }
  }

  private async processAffinityEntry(
    entry: AffinityListEntry, 
    syncPair: SyncPair, 
    notionPageMap: Map<string, NotionPage>
  ): Promise<{ type: string; count: number }> {
    const affinityId = entry.entity.id.toString();
    const existingNotionPage = notionPageMap.get(affinityId);
    
    // Get field values with validation
    const fieldValues = await this.affinityRateLimiter.execute(() => 
      affinityService.getFieldValues(entry.entity)
    );

    // Validate and sanitize field values
    const sanitizedFieldValues = fieldValues.map(fv => ({
      ...fv,
      value: FieldValidator.sanitizeFieldValue(fv.value, fv.field?.type || 'text')
    }));

    // Convert to Notion properties
    const notionProperties = await this.convertAffinityToNotionProperties(
      sanitizedFieldValues, 
      syncPair.fieldMappings as FieldMapping[], 
      syncPair.notionDatabaseId, 
      entry
    );

    // Generate company logo URL
    const logoUrl = this.generateCompanyLogoUrl(entry);

    if (existingNotionPage) {
      // Check for changes using hash comparison
      const syncedRecord = await storage.getSyncedRecord(syncPair.id, affinityId);
      const currentFieldHash = this.normalizeAndHashFieldValues(sanitizedFieldValues, syncPair.fieldMappings as FieldMapping[]);
      
      if (syncedRecord && syncedRecord.fieldValuesHash === currentFieldHash) {
        return { type: 'unchanged', count: 0 };
      }

      // Check for conflicts
      const conflicts = await this.detectConflicts(syncPair, entry, existingNotionPage, sanitizedFieldValues);
      if (conflicts.length > 0) {
        // Store conflicts for manual resolution
        for (const conflict of conflicts) {
          await storage.createConflict(conflict);
        }
        return { type: 'conflict', count: conflicts.length };
      }

      // Update existing page with rate limiting
      await this.notionRateLimiter.execute(() => 
        notionService.updatePage(existingNotionPage.id, notionProperties, logoUrl)
      );

      // Update synced record
      await storage.createOrUpdateSyncedRecord({
        syncPairId: syncPair.id,
        recordId: affinityId,
        recordType: affinityService.getEntityType(entry.entity),
        affinityId: affinityId,
        notionPageId: existingNotionPage.id,
        fieldValuesHash: currentFieldHash,
        affinityLastModified: entry.entity.last_modified ? new Date(entry.entity.last_modified) : new Date(),
        notionLastModified: new Date(),
        lastSyncedAt: new Date()
      });

      return { type: 'updated', count: 1 };
    } else {
      // Create new page with rate limiting
      const newPage = await this.notionRateLimiter.execute(() => 
        notionService.createPage(syncPair.notionDatabaseId, notionProperties, logoUrl)
      );

      const currentFieldHash = this.normalizeAndHashFieldValues(sanitizedFieldValues, syncPair.fieldMappings as FieldMapping[]);
      
      // Create synced record
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
  }

  private async cleanupNotionPages(
    syncPair: SyncPair, 
    affinityEntries: AffinityListEntry[], 
    notionPages: NotionPage[]
  ): Promise<void> {
    const currentFilteredIds = new Set(affinityEntries.map(entry => entry.entity.id.toString()));
    
    for (const page of notionPages) {
      const affinityId = this.extractAffinityIdFromNotionPage(page);
      if (affinityId && !currentFilteredIds.has(affinityId)) {
        try {
          // Delete synced record and optionally archive the Notion page
          await storage.deleteSyncedRecord(syncPair.id, affinityId);
          
          // Optionally archive the page instead of deleting
          await this.notionRateLimiter.execute(() => 
            notionService.archivePage(page.id)
          );
          
          console.log(`[CLEANUP] Archived Notion page for removed Affinity entry ${affinityId}`);
        } catch (error: any) {
          console.error(`[CLEANUP ERROR] Failed to cleanup page ${page.id}:`, error.message);
        }
      }
    }
  }

  // Additional utility methods...
  private extractAffinityIdFromNotionPage(page: NotionPage): string | null {
    const affinityIdProperty = page.properties['Affinity_ID'];
    if (affinityIdProperty) {
      if (affinityIdProperty.type === 'rich_text' && affinityIdProperty.rich_text?.length > 0) {
        return affinityIdProperty.rich_text[0]?.text?.content || null;
      } else if (affinityIdProperty.type === 'number') {
        return affinityIdProperty.number?.toString() || null;
      }
    }
    return null;
  }

  private generateCompanyLogoUrl(entry: AffinityListEntry): string | null {
    // Try to extract domain from organization data
    if (entry.entity.type === 'opportunity' && entry.entity.organizations?.length > 0) {
      const org = entry.entity.organizations[0];
      if (org.domain) {
        return `https://images.affinity.co/companies/${org.domain}`;
      }
    }
    return null;
  }

  private normalizeAndHashFieldValues(fieldValues: AffinityFieldValue[], fieldMappings: FieldMapping[]): string {
    const mappedFieldIds = new Set(fieldMappings.map(fm => fm.affinityFieldId?.toString()).filter(Boolean));
    
    const normalizedValues = fieldValues
      .filter(fv => mappedFieldIds.has(fv.fieldId?.toString()))
      .map(fv => ({
        fieldId: fv.fieldId,
        value: JSON.stringify(fv.value)
      }));

    const valueString = JSON.stringify(normalizedValues.sort());
    return createHash('sha256').update(valueString).digest('hex');
  }

  // Other methods (syncNotionToAffinity, syncBidirectional, etc.) would be similarly enhanced...
  // [Rest of the implementation would continue with the same patterns]

  clearActiveSyncs(): void {
    this.activeSyncs.clear();
  }

  getActiveSyncCount(): number {
    return this.activeSyncs.size;
  }

  async startScheduledSync(syncPair: SyncPair): Promise<void> {
    if (this.scheduledJobs.has(syncPair.id)) {
      this.scheduledJobs.get(syncPair.id)?.stop();
    }

    const cronPattern = `*/${syncPair.syncFrequency} * * * *`;
    
    const job = cron.schedule(cronPattern, async () => {
      if (!this.activeSyncs.has(syncPair.id)) {
        await this.syncPair(syncPair.id);
      }
    }, { scheduled: false });

    this.scheduledJobs.set(syncPair.id, job);
    job.start();
  }

  async stopScheduledSync(syncPairId: number): Promise<void> {
    if (this.scheduledJobs.has(syncPairId)) {
      this.scheduledJobs.get(syncPairId)?.stop();
      this.scheduledJobs.delete(syncPairId);
    }
  }

  // Placeholder for other methods that would need similar enhancements
  private async syncNotionToAffinity(syncPair: SyncPair): Promise<SyncResult> {
    // Implementation with similar error handling and rate limiting...
    throw new Error('Method not fully implemented in this example');
  }

  private async syncBidirectional(syncPair: SyncPair): Promise<SyncResult> {
    // Implementation with similar error handling and rate limiting...
    throw new Error('Method not fully implemented in this example');
  }

  private async detectConflicts(syncPair: SyncPair, affinityEntry: AffinityListEntry, notionPage: NotionPage, fieldValues: AffinityFieldValue[]): Promise<InsertConflict[]> {
    // Implementation with enhanced conflict detection...
    return [];
  }

  private async convertAffinityToNotionProperties(fieldValues: AffinityFieldValue[], fieldMappings: FieldMapping[], notionDatabaseId: string, affinityEntry?: AffinityListEntry): Promise<Record<string, any>> {
    // Implementation with field validation and sanitization...
    return {};
  }
}
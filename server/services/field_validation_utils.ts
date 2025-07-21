import type { AffinityField, NotionProperty, FieldMapping } from "@shared/types";

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Phone number regex (supports various formats)
const PHONE_REGEX = /^[\+]?[1-9]?[\d\s\-\(\)\.]{10,}$/;

// URL validation regex
const URL_REGEX = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/;

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  warnings: ValidationWarning[];
  suggestions?: string[];
}

export interface ValidationIssue {
  type: 'type_mismatch' | 'format_invalid' | 'required_missing' | 'value_too_long';
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationWarning {
  type: 'data_loss' | 'format_change' | 'compatibility';
  field: string;
  message: string;
  suggestion?: string;
}

export class FieldValidator {
  /**
   * Validates field mapping compatibility between Affinity and Notion
   */
  static validateMapping(
    affinityField: AffinityField, 
    notionPropertyType: string,
    notionProperty?: NotionProperty
  ): ValidationResult {
    const issues: ValidationIssue[] = [];
    const warnings: ValidationWarning[] = [];
    const suggestions: string[] = [];

    // Check basic type compatibility
    const compatibility = this.checkTypeCompatibility(affinityField.type, notionPropertyType);
    
    if (!compatibility.compatible) {
      issues.push({
        type: 'type_mismatch',
        field: affinityField.name,
        message: `Affinity field type '${affinityField.type}' cannot be mapped to Notion property type '${notionPropertyType}'`,
        severity: 'error'
      });
      
      if (compatibility.suggestedTypes.length > 0) {
        suggestions.push(`Consider using one of these Notion property types: ${compatibility.suggestedTypes.join(', ')}`);
      }
    } else if (compatibility.dataLoss) {
      warnings.push({
        type: 'data_loss',
        field: affinityField.name,
        message: compatibility.warningMessage || 'Some data formatting may be lost in this mapping',
        suggestion: compatibility.suggestion
      });
    }

    // Check for dropdown/select option compatibility
    if (affinityField.type === 'dropdown' && (notionPropertyType === 'select' || notionPropertyType === 'multi_select')) {
      this.validateDropdownOptions(affinityField, notionProperty, warnings);
    }

    // Check field name compatibility
    if (affinityField.name.length > 100) {
      warnings.push({
        type: 'format_change',
        field: affinityField.name,
        message: 'Field name is very long and may be truncated in Notion',
        suggestion: 'Consider using a shorter property name in Notion'
      });
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings,
      suggestions: suggestions.length > 0 ? suggestions : undefined
    };
  }

  /**
   * Sanitizes and validates field values based on their target type
   */
  static sanitizeFieldValue(value: any, targetType: string, options?: { strict?: boolean }): {
    sanitizedValue: any;
    isValid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];
    let sanitizedValue = value;
    let isValid = true;

    if (value === null || value === undefined || value === '') {
      return { sanitizedValue: null, isValid: true, issues: [] };
    }

    switch (targetType) {
      case 'email':
        sanitizedValue = String(value).trim().toLowerCase();
        if (!EMAIL_REGEX.test(sanitizedValue)) {
          if (options?.strict) {
            isValid = false;
            sanitizedValue = null;
          }
          issues.push(`Invalid email format: ${value}`);
        }
        break;

      case 'phone_number':
        // Clean phone number - remove extra spaces and formatting
        sanitizedValue = String(value).replace(/[^\d\+\-\(\)\.]/g, '');
        if (!PHONE_REGEX.test(sanitizedValue)) {
          if (options?.strict) {
            isValid = false;
            sanitizedValue = null;
          } else {
            // Try to salvage what we can
            const digitsOnly = sanitizedValue.replace(/[^\d]/g, '');
            if (digitsOnly.length >= 10) {
              sanitizedValue = digitsOnly;
            } else {
              sanitizedValue = null;
              issues.push(`Invalid phone number format: ${value}`);
            }
          }
        }
        break;

      case 'url':
        try {
          // Try to parse as-is first
          if (typeof value === 'string' && URL_REGEX.test(value)) {
            sanitizedValue = value;
          } else {
            // Try adding https:// prefix
            const withProtocol = `https://${String(value)}`;
            if (URL_REGEX.test(withProtocol)) {
              sanitizedValue = withProtocol;
            } else {
              throw new Error('Invalid URL');
            }
          }
        } catch {
          if (options?.strict) {
            isValid = false;
            sanitizedValue = null;
          }
          issues.push(`Invalid URL format: ${value}`);
        }
        break;

      case 'number':
        const num = parseFloat(String(value).replace(/[^\d\.-]/g, ''));
        if (isNaN(num)) {
          if (options?.strict) {
            isValid = false;
            sanitizedValue = null;
          }
          issues.push(`Invalid number format: ${value}`);
        } else {
          sanitizedValue = num;
        }
        break;

      case 'date':
        try {
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            throw new Error('Invalid date');
          }
          sanitizedValue = date.toISOString().split('T')[0]; // YYYY-MM-DD format
        } catch {
          if (options?.strict) {
            isValid = false;
            sanitizedValue = null;
          }
          issues.push(`Invalid date format: ${value}`);
        }
        break;

      case 'checkbox':
        // Convert various truthy/falsy values to boolean
        if (typeof value === 'boolean') {
          sanitizedValue = value;
        } else if (typeof value === 'string') {
          const lowered = value.toLowerCase().trim();
          sanitizedValue = ['true', 'yes', '1', 'on', 'checked'].includes(lowered);
        } else if (typeof value === 'number') {
          sanitizedValue = value !== 0;
        } else {
          sanitizedValue = Boolean(value);
        }
        break;

      case 'rich_text':
      case 'title':
        sanitizedValue = String(value).trim();
        if (sanitizedValue.length > 2000) {
          sanitizedValue = sanitizedValue.substring(0, 2000) + '...';
          issues.push(`Text was truncated to 2000 characters`);
        }
        break;

      case 'select':
      case 'multi_select':
        // Handle dropdown objects from Affinity
        if (Array.isArray(value)) {
          sanitizedValue = value
            .map(v => typeof v === 'object' && v.text ? v.text : String(v))
            .filter(Boolean);
        } else if (typeof value === 'object' && value.text) {
          sanitizedValue = [value.text];
        } else {
          sanitizedValue = [String(value)];
        }
        break;

      default:
        sanitizedValue = String(value);
    }

    return { sanitizedValue, isValid, issues };
  }

  /**
   * Validates batch field mappings for a sync pair
   */
  static validateSyncPairMappings(
    affinityFields: AffinityField[],
    notionProperties: Record<string, NotionProperty>,
    fieldMappings: FieldMapping[]
  ): {
    isValid: boolean;
    totalIssues: number;
    totalWarnings: number;
    mappingResults: Array<{
      mapping: FieldMapping;
      validation: ValidationResult;
    }>;
  } {
    let totalIssues = 0;
    let totalWarnings = 0;
    const mappingResults = [];

    for (const mapping of fieldMappings) {
      const affinityField = affinityFields.find(f => f.id === mapping.affinityFieldId);
      const notionProperty = notionProperties[mapping.notionProperty];

      if (!affinityField) {
        mappingResults.push({
          mapping,
          validation: {
            isValid: false,
            issues: [{
              type: 'required_missing' as const,
              field: mapping.affinityField || 'Unknown',
              message: `Affinity field not found: ${mapping.affinityField}`,
              severity: 'error' as const
            }],
            warnings: []
          }
        });
        totalIssues++;
        continue;
      }

      if (!notionProperty) {
        mappingResults.push({
          mapping,
          validation: {
            isValid: false,
            issues: [{
              type: 'required_missing' as const,
              field: mapping.notionProperty,
              message: `Notion property not found: ${mapping.notionProperty}`,
              severity: 'error' as const
            }],
            warnings: []
          }
        });
        totalIssues++;
        continue;
      }

      const validation = this.validateMapping(affinityField, notionProperty.type, notionProperty);
      mappingResults.push({ mapping, validation });

      totalIssues += validation.issues.length;
      totalWarnings += validation.warnings.length;
    }

    return {
      isValid: totalIssues === 0,
      totalIssues,
      totalWarnings,
      mappingResults
    };
  }

  /**
   * Suggests optimal Notion property types for Affinity fields
   */
  static suggestNotionPropertyType(affinityField: AffinityField): {
    recommended: string;
    alternatives: string[];
    reason: string;
  } {
    const typeMap: Record<string, { recommended: string; alternatives: string[]; reason: string }> = {
      'text': {
        recommended: 'rich_text',
        alternatives: ['title'],
        reason: 'Rich text supports formatting and is most flexible for text content'
      },
      'dropdown': {
        recommended: 'select',
        alternatives: ['multi_select', 'rich_text'],
        reason: 'Select maintains dropdown options and ensures data consistency'
      },
      'multi_dropdown': {
        recommended: 'multi_select',
        alternatives: ['rich_text'],
        reason: 'Multi-select preserves multiple selection capability'
      },
      'number': {
        recommended: 'number',
        alternatives: ['rich_text'],
        reason: 'Number type enables mathematical operations and proper sorting'
      },
      'date': {
        recommended: 'date',
        alternatives: ['rich_text'],
        reason: 'Date type provides calendar integration and date-specific features'
      },
      'email': {
        recommended: 'email',
        alternatives: ['rich_text', 'url'],
        reason: 'Email type provides validation and mailto link functionality'
      },
      'url': {
        recommended: 'url',
        alternatives: ['rich_text'],
        reason: 'URL type provides link validation and clickable links'
      },
      'boolean': {
        recommended: 'checkbox',
        alternatives: ['select'],
        reason: 'Checkbox provides true/false toggle functionality'
      }
    };

    return typeMap[affinityField.type] || {
      recommended: 'rich_text',
      alternatives: [],
      reason: 'Rich text is the most flexible option for unknown field types'
    };
  }

  private static checkTypeCompatibility(affinityType: string, notionType: string): {
    compatible: boolean;
    dataLoss?: boolean;
    warningMessage?: string;
    suggestion?: string;
    suggestedTypes: string[];
  } {
    const compatibilityMatrix: Record<string, Record<string, any>> = {
      'text': {
        'rich_text': { compatible: true },
        'title': { compatible: true },
        'select': { compatible: true, dataLoss: true, warningMessage: 'Text will be treated as a single select option' },
        'email': { compatible: true, dataLoss: true, warningMessage: 'Only valid emails will be preserved' },
        'url': { compatible: true, dataLoss: true, warningMessage: 'Only valid URLs will be preserved' },
        'number': { compatible: false, suggestedTypes: ['rich_text'] },
        'date': { compatible: false, suggestedTypes: ['rich_text'] }
      },
      'dropdown': {
        'select': { compatible: true },
        'multi_select': { compatible: true, warningMessage: 'Single selections will be converted to arrays' },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'Dropdown structure will be lost' },
        'number': { compatible: false, suggestedTypes: ['select', 'rich_text'] },
        'date': { compatible: false, suggestedTypes: ['select', 'rich_text'] }
      },
      'multi_dropdown': {
        'multi_select': { compatible: true },
        'select': { compatible: true, dataLoss: true, warningMessage: 'Only first selection will be preserved' },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'Multiple selections will be joined as text' }
      },
      'number': {
        'number': { compatible: true },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'Number formatting and calculations will be lost' },
        'select': { compatible: false, suggestedTypes: ['number', 'rich_text'] }
      },
      'date': {
        'date': { compatible: true },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'Date functionality will be lost' }
      },
      'boolean': {
        'checkbox': { compatible: true },
        'select': { compatible: true, warningMessage: 'Boolean values will become select options' },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'True/false functionality will be lost' }
      },
      'email': {
        'email': { compatible: true },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'Email validation and mailto links will be lost' },
        'url': { compatible: true, dataLoss: true, warningMessage: 'Email will be treated as URL' }
      },
      'url': {
        'url': { compatible: true },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'Clickable links will be lost' }
      }
    };

    const compatibility = compatibilityMatrix[affinityType]?.[notionType];
    
    if (!compatibility) {
      return {
        compatible: false,
        suggestedTypes: ['rich_text'] // Default fallback
      };
    }

    return {
      compatible: compatibility.compatible,
      dataLoss: compatibility.dataLoss,
      warningMessage: compatibility.warningMessage,
      suggestion: compatibility.suggestion,
      suggestedTypes: compatibility.suggestedTypes || []
    };
  }

  private static validateDropdownOptions(
    affinityField: AffinityField,
    notionProperty: NotionProperty | undefined,
    warnings: ValidationWarning[]
  ) {
    if (!affinityField.options || !notionProperty) return;

    const affinityOptions = affinityField.options.map(opt => opt.text || opt.name);
    const notionOptions = notionProperty.type === 'select' 
      ? notionProperty.select?.options?.map(opt => opt.name) || []
      : notionProperty.multi_select?.options?.map(opt => opt.name) || [];

    const missingOptions = affinityOptions.filter(opt => !notionOptions.includes(opt));
    
    if (missingOptions.length > 0) {
      warnings.push({
        type: 'compatibility',
        field: affinityField.name,
        message: `Some Affinity dropdown options are missing in Notion: ${missingOptions.join(', ')}`,
        suggestion: 'Consider adding these options to the Notion property or they will be created automatically'
      });
    }
  }
}

// Monitoring and alerting utilities
export class SyncMonitor {
  private static instance: SyncMonitor;
  private alerts: Array<{
    id: string;
    type: 'error' | 'warning' | 'info';
    message: string;
    timestamp: Date;
    syncPairId?: number;
    resolved: boolean;
  }> = [];

  static getInstance(): SyncMonitor {
    if (!SyncMonitor.instance) {
      SyncMonitor.instance = new SyncMonitor();
    }
    return SyncMonitor.instance;
  }

  /**
   * Create a new alert
   */
  createAlert(
    type: 'error' | 'warning' | 'info',
    message: string,
    syncPairId?: number
  ): string {
    const id = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.alerts.push({
      id,
      type,
      message,
      timestamp: new Date(),
      syncPairId,
      resolved: false
    });

    // Auto-resolve info alerts after 1 hour
    if (type === 'info') {
      setTimeout(() => this.resolveAlert(id), 60 * 60 * 1000);
    }

    // Send notification based on type
    this.sendNotification(type, message, syncPairId);

    return id;
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      return true;
    }
    return false;
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(syncPairId?: number): Array<any> {
    let alerts = this.alerts.filter(a => !a.resolved);
    
    if (syncPairId) {
      alerts = alerts.filter(a => a.syncPairId === syncPairId);
    }

    return alerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Clear old resolved alerts
   */
  cleanupAlerts(): void {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    this.alerts = this.alerts.filter(alert => 
      !alert.resolved || alert.timestamp > oneDayAgo
    );
  }

  /**
   * Monitor sync health and create alerts
   */
  monitorSyncHealth(syncResult: any, syncPairId: number): void {
    if (!syncResult.success) {
      this.createAlert(
        'error',
        `Sync failed for pair ${syncPairId}: ${syncResult.errorMessage}`,
        syncPairId
      );
    } else if (syncResult.conflictsFound > 0) {
      this.createAlert(
        'warning',
        `${syncResult.conflictsFound} conflicts found in sync pair ${syncPairId}`,
        syncPairId
      );
    } else if (syncResult.duration > 60000) { // More than 1 minute
      this.createAlert(
        'warning',
        `Sync pair ${syncPairId} took ${Math.round(syncResult.duration / 1000)}s to complete`,
        syncPairId
      );
    }

    // Monitor for unusual patterns
    if (syncResult.recordsCreated > 100) {
      this.createAlert(
        'info',
        `Sync pair ${syncPairId} created ${syncResult.recordsCreated} new records`,
        syncPairId
      );
    }
  }

  /**
   * Send notifications (placeholder for integration with external services)
   */
  private sendNotification(
    type: 'error' | 'warning' | 'info',
    message: string,
    syncPairId?: number
  ): void {
    // In a real implementation, this would integrate with:
    // - Slack webhook
    // - Email service
    // - SMS service
    // - Push notifications
    // - Logging service (e.g., Datadog, New Relic)

    console.log(`[${type.toUpperCase()}] ${message}`, { syncPairId });

    // Example Slack integration (commented out)
    /*
    if (type === 'error' && process.env.SLACK_WEBHOOK_URL) {
      const payload = {
        text: `🚨 Sync Error: ${message}`,
        channel: '#sync-alerts',
        username: 'SyncBot',
        attachments: [{
          color: 'danger',
          fields: [{
            title: 'Sync Pair ID',
            value: syncPairId?.toString() || 'Unknown',
            short: true
          }, {
            title: 'Timestamp',
            value: new Date().toISOString(),
            short: true
          }]
        }]
      };

      fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(err => console.error('Failed to send Slack notification:', err));
    }
    */
  }

  /**
   * Generate health report for all sync pairs
   */
  generateHealthReport(syncPairs: any[], syncHistory: any[]): {
    overall: 'healthy' | 'warning' | 'critical';
    summary: {
      totalSyncPairs: number;
      activeSyncPairs: number;
      recentFailures: number;
      avgSyncDuration: number;
      conflictsNeedingResolution: number;
    };
    recommendations: string[];
    alerts: Array<any>;
  } {
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentHistory = syncHistory.filter(h => new Date(h.createdAt) > last24Hours);
    
    const recentFailures = recentHistory.filter(h => h.status === 'error').length;
    const avgDuration = recentHistory.length > 0 
      ? recentHistory.reduce((sum, h) => sum + (h.duration || 0), 0) / recentHistory.length
      : 0;

    const activeAlerts = this.getActiveAlerts();
    const errorAlerts = activeAlerts.filter(a => a.type === 'error').length;
    const warningAlerts = activeAlerts.filter(a => a.type === 'warning').length;

    // Determine overall health
    let overall: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (errorAlerts > 0 || recentFailures > 5) {
      overall = 'critical';
    } else if (warningAlerts > 3 || recentFailures > 2 || avgDuration > 30000) {
      overall = 'warning';
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (avgDuration > 60000) {
      recommendations.push('Consider optimizing sync performance - average duration is over 1 minute');
    }
    if (recentFailures > 0) {
      recommendations.push(`Review and resolve ${recentFailures} recent sync failures`);
    }
    if (warningAlerts > 0) {
      recommendations.push(`Address ${warningAlerts} active warnings`);
    }

    return {
      overall,
      summary: {
        totalSyncPairs: syncPairs.length,
        activeSyncPairs: syncPairs.filter(sp => sp.isActive).length,
        recentFailures,
        avgSyncDuration: Math.round(avgDuration),
        conflictsNeedingResolution: 0 // Would be fetched from conflicts table
      },
      recommendations,
      alerts: activeAlerts.slice(0, 10) // Top 10 most recent
    };
  }
}

// Performance monitoring utilities
export class PerformanceMonitor {
  private static measurements = new Map<string, Array<{
    timestamp: number;
    duration: number;
    metadata?: any;
  }>>();

  /**
   * Start measuring performance for an operation
   */
  static startMeasurement(operationId: string): () => void {
    const startTime = Date.now();
    
    return (metadata?: any) => {
      const duration = Date.now() - startTime;
      this.recordMeasurement(operationId, duration, metadata);
    };
  }

  /**
   * Record a performance measurement
   */
  static recordMeasurement(operationId: string, duration: number, metadata?: any): void {
    if (!this.measurements.has(operationId)) {
      this.measurements.set(operationId, []);
    }

    const measurements = this.measurements.get(operationId)!;
    measurements.push({
      timestamp: Date.now(),
      duration,
      metadata
    });

    // Keep only last 1000 measurements per operation
    if (measurements.length > 1000) {
      measurements.splice(0, measurements.length - 1000);
    }
  }

  /**
   * Get performance statistics for an operation
   */
  static getStats(operationId: string, timeRangeMs = 24 * 60 * 60 * 1000): {
    count: number;
    averageDuration: number;
    minDuration: number;
    maxDuration: number;
    p95Duration: number;
    recentTrend: 'improving' | 'degrading' | 'stable';
  } | null {
    const measurements = this.measurements.get(operationId);
    if (!measurements || measurements.length === 0) return null;

    const cutoff = Date.now() - timeRangeMs;
    const recentMeasurements = measurements
      .filter(m => m.timestamp > cutoff)
      .map(m => m.duration)
      .sort((a, b) => a - b);

    if (recentMeasurements.length === 0) return null;

    const count = recentMeasurements.length;
    const sum = recentMeasurements.reduce((a, b) => a + b, 0);
    const averageDuration = sum / count;
    const minDuration = recentMeasurements[0];
    const maxDuration = recentMeasurements[recentMeasurements.length - 1];
    const p95Index = Math.floor(recentMeasurements.length * 0.95);
    const p95Duration = recentMeasurements[p95Index];

    // Calculate trend (compare first half vs second half)
    const midpoint = Math.floor(recentMeasurements.length / 2);
    const firstHalfAvg = recentMeasurements.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint;
    const secondHalfAvg = recentMeasurements.slice(midpoint).reduce((a, b) => a + b, 0) / (recentMeasurements.length - midpoint);
    
    let recentTrend: 'improving' | 'degrading' | 'stable' = 'stable';
    const trendThreshold = 0.1; // 10% change
    if (secondHalfAvg < firstHalfAvg * (1 - trendThreshold)) {
      recentTrend = 'improving';
    } else if (secondHalfAvg > firstHalfAvg * (1 + trendThreshold)) {
      recentTrend = 'degrading';
    }

    return {
      count,
      averageDuration: Math.round(averageDuration),
      minDuration,
      maxDuration,
      p95Duration,
      recentTrend
    };
  }

  /**
   * Get all operation performance stats
   */
  static getAllStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    
    for (const [operationId] of this.measurements) {
      stats[operationId] = this.getStats(operationId);
    }

    return stats;
  }

  /**
   * Clear old measurements to free up memory
   */
  static cleanup(): void {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    for (const [operationId, measurements] of this.measurements) {
      const filtered = measurements.filter(m => m.timestamp > oneDayAgo);
      if (filtered.length === 0) {
        this.measurements.delete(operationId);
      } else {
        this.measurements.set(operationId, filtered);
      }
    }
  }
}

// Data quality checker
export class DataQualityChecker {
  /**
   * Analyze field value quality across a dataset
   */
  static analyzeFieldQuality(
    fieldValues: Array<{ fieldId: string; value: any; fieldType?: string }>,
    fieldType: string
  ): {
    totalValues: number;
    validValues: number;
    invalidValues: number;
    nullValues: number;
    qualityScore: number; // 0-1
    issues: Array<{
      type: string;
      count: number;
      examples: any[];
    }>;
  } {
    const issues: Array<{ type: string; count: number; examples: any[] }> = [];
    let validCount = 0;
    let invalidCount = 0;
    let nullCount = 0;

    const emailIssues: any[] = [];
    const urlIssues: any[] = [];
    const numberIssues: any[] = [];
    const dateIssues: any[] = [];

    for (const fieldValue of fieldValues) {
      if (fieldValue.value === null || fieldValue.value === undefined || fieldValue.value === '') {
        nullCount++;
        continue;
      }

      const { isValid, issues: valueIssues } = FieldValidator.sanitizeFieldValue(
        fieldValue.value, 
        fieldType, 
        { strict: true }
      );

      if (isValid) {
        validCount++;
      } else {
        invalidCount++;
        
        // Categorize issues
        if (fieldType === 'email' && valueIssues.length > 0) {
          emailIssues.push(fieldValue.value);
        } else if (fieldType === 'url' && valueIssues.length > 0) {
          urlIssues.push(fieldValue.value);
        } else if (fieldType === 'number' && valueIssues.length > 0) {
          numberIssues.push(fieldValue.value);
        } else if (fieldType === 'date' && valueIssues.length > 0) {
          dateIssues.push(fieldValue.value);
        }
      }
    }

    // Add issue summaries
    if (emailIssues.length > 0) {
      issues.push({
        type: 'invalid_email',
        count: emailIssues.length,
        examples: emailIssues.slice(0, 5)
      });
    }

    if (urlIssues.length > 0) {
      issues.push({
        type: 'invalid_url',
        count: urlIssues.length,
        examples: urlIssues.slice(0, 5)
      });
    }

    if (numberIssues.length > 0) {
      issues.push({
        type: 'invalid_number',
        count: numberIssues.length,
        examples: numberIssues.slice(0, 5)
      });
    }

    if (dateIssues.length > 0) {
      issues.push({
        type: 'invalid_date',
        count: dateIssues.length,
        examples: dateIssues.slice(0, 5)
      });
    }

    const totalValues = fieldValues.length;
    const qualityScore = totalValues > 0 ? validCount / totalValues : 1;

    return {
      totalValues,
      validValues: validCount,
      invalidValues: invalidCount,
      nullValues: nullCount,
      qualityScore,
      issues
    };
  }

  /**
   * Generate data quality report for sync pair
   */
  static generateDataQualityReport(
    affinityData: any[],
    fieldMappings: FieldMapping[]
  ): {
    overallScore: number;
    fieldAnalysis: Array<{
      fieldId: string;
      fieldName: string;
      analysis: ReturnType<typeof DataQualityChecker.analyzeFieldQuality>;
    }>;
    recommendations: string[];
  } {
    const fieldAnalysis = [];
    let totalScore = 0;

    for (const mapping of fieldMappings) {
      const fieldValues = affinityData
        .map(entry => ({
          fieldId: mapping.affinityFieldId?.toString() || '',
          value: entry.fieldValues?.find((fv: any) => fv.fieldId === mapping.affinityFieldId)?.value,
          fieldType: mapping.affinityFieldType
        }))
        .filter(fv => fv.value !== undefined);

      const analysis = this.analyzeFieldQuality(fieldValues, mapping.affinityFieldType || 'text');
      
      fieldAnalysis.push({
        fieldId: mapping.affinityFieldId?.toString() || '',
        fieldName: mapping.affinityField,
        analysis
      });

      totalScore += analysis.qualityScore;
    }

    const overallScore = fieldMappings.length > 0 ? totalScore / fieldMappings.length : 1;

    // Generate recommendations
    const recommendations: string[] = [];
    
    const lowQualityFields = fieldAnalysis.filter(fa => fa.analysis.qualityScore < 0.8);
    if (lowQualityFields.length > 0) {
      recommendations.push(`${lowQualityFields.length} fields have data quality issues that may affect sync reliability`);
    }

    const highNullFields = fieldAnalysis.filter(fa => fa.analysis.nullValues > fa.analysis.totalValues * 0.5);
    if (highNullFields.length > 0) {
      recommendations.push(`${highNullFields.length} fields have more than 50% null values - consider if they're needed for sync`);
    }

    return {
      overallScore,
      fieldAnalysis,
      recommendations
    };
  }
}
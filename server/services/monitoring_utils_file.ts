// server/utils/monitoring.ts

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

// Rate limiter class for API calls
export class RateLimiter {
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
export class RetryHandler {
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
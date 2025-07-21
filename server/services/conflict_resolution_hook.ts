// client/src/hooks/useConflictResolution.ts
import { useState } from 'react';

interface Conflict {
  id: number;
  recordId: string;
  fieldName: string;
  affinityValue: any;
  notionValue: any;
  affinityLastModified: string;
  notionLastModified: string;
  status: 'pending' | 'resolved';
  createdAt: string;
  syncPairName?: string;
}

// Hook for using the conflict resolution functionality
export const useConflictResolution = () => {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isResolving, setIsResolving] = useState(false);

  const fetchConflicts = async (syncPairId?: number) => {
    setIsLoading(true);
    try {
      const url = syncPairId 
        ? `/api/conflicts?syncPairId=${syncPairId}`
        : '/api/conflicts';
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch conflicts');
      
      const data = await response.json();
      setConflicts(data);
    } catch (error) {
      console.error('Failed to fetch conflicts:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const resolveConflict = async (conflictId: number, resolution: 'affinity' | 'notion') => {
    setIsResolving(true);
    try {
      const response = await fetch(`/api/conflicts/${conflictId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution })
      });

      if (!response.ok) throw new Error('Failed to resolve conflict');

      // Update local state
      setConflicts(prev => prev.map(conflict => 
        conflict.id === conflictId 
          ? { ...conflict, status: 'resolved' as const }
          : conflict
      ));
    } catch (error) {
      console.error('Failed to resolve conflict:', error);
      throw error;
    } finally {
      setIsResolving(false);
    }
  };

  const resolveBulkConflicts = async (conflictIds: number[], resolution: 'affinity' | 'notion') => {
    setIsResolving(true);
    try {
      const response = await fetch('/api/conflicts/bulk-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conflictIds, resolution })
      });

      if (!response.ok) throw new Error('Failed to resolve conflicts');

      const data = await response.json();
      
      // Update local state for successfully resolved conflicts
      const resolvedIds = data.results
        .filter((result: any) => result.success)
        .map((result: any) => result.id);

      setConflicts(prev => prev.map(conflict => 
        resolvedIds.includes(conflict.id)
          ? { ...conflict, status: 'resolved' as const }
          : conflict
      ));

      // Return results for error handling
      return data.results;
    } catch (error) {
      console.error('Failed to resolve conflicts in bulk:', error);
      throw error;
    } finally {
      setIsResolving(false);
    }
  };

  return {
    conflicts,
    isLoading,
    isResolving,
    fetchConflicts,
    resolveConflict,
    resolveBulkConflicts
  };
};
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, Clock, User, Database, CheckCircle, XCircle, Eye } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';

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

interface ConflictResolutionProps {
  conflicts: Conflict[];
  isOpen: boolean;
  onClose: () => void;
  onResolve: (conflictId: number, resolution: 'affinity' | 'notion') => Promise<void>;
  onBulkResolve: (conflictIds: number[], resolution: 'affinity' | 'notion') => Promise<void>;
  isResolving?: boolean;
}

const ConflictResolution: React.FC<ConflictResolutionProps> = ({
  conflicts,
  isOpen,
  onClose,
  onResolve,
  onBulkResolve,
  isResolving = false
}) => {
  const [selectedConflicts, setSelectedConflicts] = useState<Set<number>>(new Set());
  const [currentView, setCurrentView] = useState<'list' | 'comparison'>('list');
  const [selectedConflict, setSelectedConflict] = useState<Conflict | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'resolved'>('pending');
  const [sortBy, setSortBy] = useState<'date' | 'field' | 'priority'>('date');

  // Reset selections when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedConflicts(new Set());
      setSelectedConflict(null);
      setCurrentView('list');
    }
  }, [isOpen]);

  // Filter and sort conflicts
  const filteredConflicts = conflicts
    .filter(conflict => {
      if (filterStatus === 'all') return true;
      return conflict.status === filterStatus;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'field':
          return a.fieldName.localeCompare(b.fieldName);
        case 'priority':
          // Priority based on recency of changes and data type
          const aPriority = getPriorityScore(a);
          const bPriority = getPriorityScore(b);
          return bPriority - aPriority;
        default:
          return 0;
      }
    });

  const pendingConflicts = filteredConflicts.filter(c => c.status === 'pending');

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedConflicts(new Set(pendingConflicts.map(c => c.id)));
    } else {
      setSelectedConflicts(new Set());
    }
  };

  const handleSelectConflict = (conflictId: number, checked: boolean) => {
    const newSelected = new Set(selectedConflicts);
    if (checked) {
      newSelected.add(conflictId);
    } else {
      newSelected.delete(conflictId);
    }
    setSelectedConflicts(newSelected);
  };

  const handleBulkResolve = async (resolution: 'affinity' | 'notion') => {
    if (selectedConflicts.size === 0) return;
    
    try {
      await onBulkResolve(Array.from(selectedConflicts), resolution);
      setSelectedConflicts(new Set());
    } catch (error) {
      console.error('Bulk resolution failed:', error);
    }
  };

  const handleSingleResolve = async (conflictId: number, resolution: 'affinity' | 'notion') => {
    try {
      await onResolve(conflictId, resolution);
      if (selectedConflict?.id === conflictId) {
        setSelectedConflict(null);
        setCurrentView('list');
      }
    } catch (error) {
      console.error('Single resolution failed:', error);
    }
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  const getValueType = (value: any): string => {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  };

  const getPriorityScore = (conflict: Conflict): number => {
    let score = 0;
    
    // More recent conflicts get higher priority
    const daysSinceCreated = (Date.now() - new Date(conflict.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    score += Math.max(0, 10 - daysSinceCreated);
    
    // Critical fields get higher priority
    const criticalFields = ['status', 'amount', 'stage', 'owner', 'close_date'];
    if (criticalFields.some(field => conflict.fieldName.toLowerCase().includes(field))) {
      score += 5;
    }
    
    return score;
  };

  const getConflictIcon = (conflict: Conflict) => {
    const affinityTime = new Date(conflict.affinityLastModified).getTime();
    const notionTime = new Date(conflict.notionLastModified).getTime();
    
    if (Math.abs(affinityTime - notionTime) < 60000) { // Within 1 minute
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    }
    return <Clock className="h-4 w-4 text-yellow-500" />;
  };

  const ComparisonView = ({ conflict }: { conflict: Conflict }) => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {getConflictIcon(conflict)}
          <h3 className="text-lg font-semibold">Field: {conflict.fieldName}</h3>
        </div>
        <Badge variant={conflict.status === 'pending' ? 'destructive' : 'secondary'}>
          {conflict.status}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card className="border-blue-200">
          <CardHeader className="bg-blue-50">
            <CardTitle className="flex items-center gap-2 text-blue-700">
              <Database className="h-4 w-4" />
              Affinity Value
            </CardTitle>
            <p className="text-sm text-blue-600">
              Last modified: {new Date(conflict.affinityLastModified).toLocaleString()}
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                Type: {getValueType(conflict.affinityValue)}
              </div>
              <pre className="bg-gray-50 p-3 rounded text-sm overflow-auto max-h-40">
                {formatValue(conflict.affinityValue)}
              </pre>
            </div>
          </CardContent>
        </Card>

        <Card className="border-purple-200">
          <CardHeader className="bg-purple-50">
            <CardTitle className="flex items-center gap-2 text-purple-700">
              <User className="h-4 w-4" />
              Notion Value
            </CardTitle>
            <p className="text-sm text-purple-600">
              Last modified: {new Date(conflict.notionLastModified).toLocaleString()}
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                Type: {getValueType(conflict.notionValue)}
              </div>
              <pre className="bg-gray-50 p-3 rounded text-sm overflow-auto max-h-40">
                {formatValue(conflict.notionValue)}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>

      {conflict.status === 'pending' && (
        <div className="flex justify-center gap-4 pt-4">
          <Button 
            onClick={() => handleSingleResolve(conflict.id, 'affinity')}
            disabled={isResolving}
            variant="outline"
            className="border-blue-200 text-blue-700 hover:bg-blue-50"
          >
            <Database className="h-4 w-4 mr-2" />
            Use Affinity Value
          </Button>
          <Button 
            onClick={() => handleSingleResolve(conflict.id, 'notion')}
            disabled={isResolving}
            variant="outline"
            className="border-purple-200 text-purple-700 hover:bg-purple-50"
          >
            <User className="h-4 w-4 mr-2" />
            Use Notion Value
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Resolve Data Conflicts ({filteredConflicts.length})
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <Tabs value={currentView} onValueChange={(view) => setCurrentView(view as any)}>
            <div className="flex items-center justify-between mb-4">
              <TabsList>
                <TabsTrigger value="list">Conflict List</TabsTrigger>
                <TabsTrigger value="comparison" disabled={!selectedConflict}>
                  Detailed Comparison
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-2">
                <select 
                  value={filterStatus} 
                  onChange={(e) => setFilterStatus(e.target.value as any)}
                  className="px-3 py-1 border rounded text-sm"
                >
                  <option value="all">All Conflicts</option>
                  <option value="pending">Pending</option>
                  <option value="resolved">Resolved</option>
                </select>
                <select 
                  value={sortBy} 
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-3 py-1 border rounded text-sm"
                >
                  <option value="date">Sort by Date</option>
                  <option value="field">Sort by Field</option>
                  <option value="priority">Sort by Priority</option>
                </select>
              </div>
            </div>

            <TabsContent value="list" className="h-96 overflow-auto">
              {filteredConflicts.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <CheckCircle className="h-8 w-8 mr-2" />
                  No conflicts found
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingConflicts.length > 0 && (
                    <div className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                      <Checkbox
                        checked={selectedConflicts.size === pendingConflicts.length}
                        onCheckedChange={handleSelectAll}
                      />
                      <span className="text-sm font-medium">
                        Select All ({pendingConflicts.length} pending)
                      </span>
                    </div>
                  )}

                  {filteredConflicts.map((conflict) => (
                    <Card key={conflict.id} className={`transition-colors ${
                      selectedConflicts.has(conflict.id) ? 'ring-2 ring-blue-500' : ''
                    }`}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          {conflict.status === 'pending' && (
                            <Checkbox
                              checked={selectedConflicts.has(conflict.id)}
                              onCheckedChange={(checked) => 
                                handleSelectConflict(conflict.id, checked as boolean)
                              }
                            />
                          )}
                          
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              {getConflictIcon(conflict)}
                              <h4 className="font-medium">{conflict.fieldName}</h4>
                              <Badge variant={conflict.status === 'pending' ? 'destructive' : 'secondary'}>
                                {conflict.status}
                              </Badge>
                              {conflict.syncPairName && (
                                <Badge variant="outline" className="text-xs">
                                  {conflict.syncPairName}
                                </Badge>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <div className="text-blue-600 font-medium">Affinity</div>
                                <div className="text-muted-foreground truncate">
                                  {formatValue(conflict.affinityValue).substring(0, 50)}
                                  {formatValue(conflict.affinityValue).length > 50 && '...'}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {new Date(conflict.affinityLastModified).toLocaleString()}
                                </div>
                              </div>

                              <div>
                                <div className="text-purple-600 font-medium">Notion</div>
                                <div className="text-muted-foreground truncate">
                                  {formatValue(conflict.notionValue).substring(0, 50)}
                                  {formatValue(conflict.notionValue).length > 50 && '...'}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {new Date(conflict.notionLastModified).toLocaleString()}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedConflict(conflict);
                                setCurrentView('comparison');
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>

                            {conflict.status === 'pending' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleSingleResolve(conflict.id, 'affinity')}
                                  disabled={isResolving}
                                  className="text-blue-600 border-blue-200 hover:bg-blue-50"
                                >
                                  Use Affinity
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleSingleResolve(conflict.id, 'notion')}
                                  disabled={isResolving}
                                  className="text-purple-600 border-purple-200 hover:bg-purple-50"
                                >
                                  Use Notion
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="comparison" className="h-96 overflow-auto">
              {selectedConflict ? (
                <ComparisonView conflict={selectedConflict} />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <XCircle className="h-8 w-8 mr-2" />
                  No conflict selected
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {selectedConflicts.size > 0 && (
              <span>{selectedConflicts.size} conflict(s) selected</span>
            )}
          </div>

          <div className="flex gap-2">
            {selectedConflicts.size > 1 && (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleBulkResolve('affinity')}
                  disabled={isResolving}
                  className="text-blue-600 border-blue-200 hover:bg-blue-50"
                >
                  <Database className="h-4 w-4 mr-2" />
                  Bulk Use Affinity ({selectedConflicts.size})
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleBulkResolve('notion')}
                  disabled={isResolving}
                  className="text-purple-600 border-purple-200 hover:bg-purple-50"
                >
                  <User className="h-4 w-4 mr-2" />
                  Bulk Use Notion ({selectedConflicts.size})
                </Button>
              </>
            )}
            
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogFooter>

        {pendingConflicts.length > 10 && (
          <Alert className="mt-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              You have {pendingConflicts.length} pending conflicts. Consider resolving them in batches to maintain data consistency.
            </AlertDescription>
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
};

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

export default ConflictResolution;
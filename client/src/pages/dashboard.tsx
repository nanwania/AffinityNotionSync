import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
  Plus, 
  Settings, 
  FolderSync, 
  Trash2, 
  AlertTriangle,
  CheckCircle,
  Clock,
  Database,
  Bell,
  User,
  ExternalLink
} from "lucide-react";
import { SyncConfigModal } from "@/components/sync-config-modal";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { SyncHistoryTable } from "@/components/sync-history-table";
import { ApiSettings } from "@/components/api-settings";
import { useSyncPairs, useDeleteSyncPair, useSyncPairNow } from "@/hooks/use-sync-pairs";
import { usePendingConflicts } from "@/hooks/use-conflicts";
import { getDashboardStats } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { SyncPair, Conflict } from "@shared/schema";

export default function Dashboard() {
  const [showSyncConfigModal, setShowSyncConfigModal] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [selectedSyncPair, setSelectedSyncPair] = useState<SyncPair | undefined>();
  const [selectedConflict, setSelectedConflict] = useState<Conflict | null>(null);

  const { toast } = useToast();
  const { data: syncPairs = [], isLoading: syncPairsLoading } = useSyncPairs();
  const { data: stats } = useQuery({
    queryKey: ["/api/dashboard/stats"],
    queryFn: getDashboardStats,
    refetchInterval: 30000, // Refetch every 30 seconds
  });
  const { data: pendingConflicts = [] } = usePendingConflicts();

  const deleteSyncPair = useDeleteSyncPair();
  const syncPairNow = useSyncPairNow();

  const handleCreateSync = () => {
    setSelectedSyncPair(undefined);
    setShowSyncConfigModal(true);
  };

  const handleEditSync = (syncPair: SyncPair) => {
    setSelectedSyncPair(syncPair);
    setShowSyncConfigModal(true);
  };

  const handleDeleteSync = async (syncPair: SyncPair) => {
    if (confirm(`Are you sure you want to delete the sync pair "${syncPair.name}"?`)) {
      try {
        await deleteSyncPair.mutateAsync(syncPair.id);
        toast({
          title: "FolderSync Pair Deleted",
          description: `"${syncPair.name}" has been deleted successfully`,
        });
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to delete sync pair",
          variant: "destructive",
        });
      }
    }
  };

  const handleSyncNow = async (syncPair: SyncPair) => {
    try {
      await syncPairNow.mutateAsync(syncPair.id);
      toast({
        title: "FolderSync Started",
        description: `FolderSync for "${syncPair.name}" has been started`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to start sync",
        variant: "destructive",
      });
    }
  };

  const handleResolveConflicts = (syncPair: SyncPair) => {
    const conflict = pendingConflicts.find(c => c.syncPairId === syncPair.id);
    if (conflict) {
      setSelectedConflict(conflict);
      setShowConflictModal(true);
    }
  };

  const getStatusBadge = (syncPair: SyncPair) => {
    const conflicts = pendingConflicts.filter(c => c.syncPairId === syncPair.id);
    
    if (conflicts.length > 0) {
      return (
        <Badge className="bg-yellow-100 text-yellow-800">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Conflicts
        </Badge>
      );
    }

    if (syncPair.isActive) {
      return (
        <Badge className="bg-green-100 text-green-800">
          <CheckCircle className="h-3 w-3 mr-1" />
          Active
        </Badge>
      );
    }

    return (
      <Badge variant="outline">
        Inactive
      </Badge>
    );
  };

  const formatLastSync = (lastSync: Date | string | null) => {
    if (!lastSync) return "Never";
    
    const now = new Date();
    const syncTime = new Date(lastSync);
    const diffMs = now.getTime() - syncTime.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hours ago`;
    return `${Math.floor(diffMins / 1440)} days ago`;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <div className="flex-shrink-0 flex items-center">
                <FolderSync className="text-primary text-xl mr-2" />
                <h1 className="text-xl font-semibold text-gray-900">Affinity-Notion FolderSync</h1>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm">
                <Bell className="h-4 w-4" />
              </Button>
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                  <User className="text-white text-sm" />
                </div>
                <span className="text-sm font-medium text-gray-700">Admin</span>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900">FolderSync Dashboard</h2>
            <Button onClick={handleCreateSync} className="bg-primary hover:bg-primary/90">
              <Plus className="h-4 w-4 mr-2" />
              Create New FolderSync
            </Button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <CheckCircle className="h-6 w-6 text-green-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm text-gray-600">Active Syncs</p>
                    <p className="text-2xl font-semibold text-gray-900">
                      {stats?.activeSyncs || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Clock className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm text-gray-600">Last FolderSync</p>
                    <p className="text-2xl font-semibold text-gray-900">
                      {formatLastSync(stats?.lastSync)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center">
                  <div className="p-2 bg-yellow-100 rounded-lg">
                    <AlertTriangle className="h-6 w-6 text-yellow-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm text-gray-600">Conflicts</p>
                    <p className="text-2xl font-semibold text-gray-900">
                      {stats?.conflicts || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <Database className="h-6 w-6 text-gray-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm text-gray-600">Records Synced</p>
                    <p className="text-2xl font-semibold text-gray-900">
                      {stats?.recordsSynced || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* FolderSync Pairs Table */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">FolderSync Pairs</h3>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Affinity List</TableHead>
                    <TableHead>Notion Database</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last FolderSync</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncPairsLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                      </TableCell>
                    </TableRow>
                  ) : syncPairs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                        No sync pairs configured yet. Create your first sync pair to get started.
                      </TableCell>
                    </TableRow>
                  ) : (
                    syncPairs.map((syncPair) => (
                      <TableRow key={syncPair.id}>
                        <TableCell>
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-8 w-8 bg-purple-100 rounded-full flex items-center justify-center">
                              <ExternalLink className="h-4 w-4 text-purple-600" />
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900">
                                {syncPair.affinityListName}
                              </div>
                              <div className="text-sm text-gray-500">
                                ID: {syncPair.affinityListId}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-8 w-8 bg-gray-100 rounded-full flex items-center justify-center">
                              <Database className="h-4 w-4 text-gray-600" />
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900">
                                {syncPair.notionDatabaseName}
                              </div>
                              <div className="text-sm text-gray-500">
                                ID: {syncPair.notionDatabaseId.slice(0, 8)}...
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(syncPair)}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {formatLastSync(syncPair.lastSync)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            {pendingConflicts.some(c => c.syncPairId === syncPair.id) && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleResolveConflicts(syncPair)}
                                className="text-yellow-600 hover:text-yellow-700"
                              >
                                <AlertTriangle className="h-4 w-4 mr-1" />
                                Resolve
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEditSync(syncPair)}
                            >
                              <Settings className="h-4 w-4 mr-1" />
                              Configure
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSyncNow(syncPair)}
                              disabled={syncPairNow.isPending}
                            >
                              <FolderSync className="h-4 w-4 mr-1" />
                              FolderSync Now
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteSync(syncPair)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>

        {/* FolderSync History */}
        <div className="mb-8">
          <SyncHistoryTable />
        </div>

        {/* API Settings */}
        <div className="mb-8">
          <ApiSettings />
        </div>

        {/* Modals */}
        <SyncConfigModal
          isOpen={showSyncConfigModal}
          onClose={() => setShowSyncConfigModal(false)}
          syncPair={selectedSyncPair}
        />

        <ConflictResolutionModal
          isOpen={showConflictModal}
          onClose={() => setShowConflictModal(false)}
          conflict={selectedConflict}
        />
      </div>
    </div>
  );
}

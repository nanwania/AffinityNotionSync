import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Eye, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { SyncHistory } from "@shared/schema";

interface SyncHistoryTableProps {
  syncPairId?: number;
}

export function SyncHistoryTable({ syncPairId }: SyncHistoryTableProps) {
  const [selectedHistory, setSelectedHistory] = useState<SyncHistory | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const { data: syncHistory = [], isLoading } = useQuery<SyncHistory[]>({
    queryKey: ["/api/sync-history", syncPairId],
  });

  const handleViewDetails = (entry: SyncHistory) => {
    setSelectedHistory(entry);
    setIsDetailsOpen(true);
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Sync History</h3>
        </div>
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return (
          <Badge className="bg-green-100 text-green-800">
            <CheckCircle className="h-3 w-3 mr-1" />
            Success
          </Badge>
        );
      case "error":
        return (
          <Badge className="bg-red-100 text-red-800">
            <XCircle className="h-3 w-3 mr-1" />
            Error
          </Badge>
        );
      case "warning":
        return (
          <Badge className="bg-yellow-100 text-yellow-800">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Warning
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDuration = (duration: number | null) => {
    if (!duration) return "Unknown";
    if (duration < 1000) return `${duration}ms`;
    return `${(duration / 1000).toFixed(1)}s`;
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString();
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Sync History</h3>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Records</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {syncHistory.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                  No sync history found
                </TableCell>
              </TableRow>
            ) : (
              syncHistory.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">
                    {formatDate(entry.createdAt)}
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(entry.status)}
                  </TableCell>
                  <TableCell>
                    {entry.recordsUpdated > 0 && `${entry.recordsUpdated} updated`}
                    {entry.recordsUpdated > 0 && entry.recordsCreated > 0 && ", "}
                    {entry.recordsCreated > 0 && `${entry.recordsCreated} created`}
                    {entry.conflictsFound > 0 && `, ${entry.conflictsFound} conflicts`}
                  </TableCell>
                  <TableCell>
                    {formatDuration(entry.duration)}
                  </TableCell>
                  <TableCell>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleViewDetails(entry)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Details Modal */}
      <Modal
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        title="Sync Details"
      >
        {selectedHistory && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">Status</label>
                <div className="mt-1">{getStatusBadge(selectedHistory.status)}</div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Duration</label>
                <p className="mt-1 text-sm">{formatDuration(selectedHistory.duration)}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Records Updated</label>
                <p className="mt-1 text-sm">{selectedHistory.recordsUpdated}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Records Created</label>
                <p className="mt-1 text-sm">{selectedHistory.recordsCreated}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Conflicts Found</label>
                <p className="mt-1 text-sm">{selectedHistory.conflictsFound}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Timestamp</label>
                <p className="mt-1 text-sm">{formatDate(selectedHistory.createdAt)}</p>
              </div>
            </div>

            {selectedHistory.errorMessage && (
              <div>
                <label className="text-sm font-medium text-gray-500">Error Message</label>
                <div className="mt-1 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-700">{selectedHistory.errorMessage}</p>
                </div>
              </div>
            )}

            {selectedHistory.details && (
              <div>
                <label className="text-sm font-medium text-gray-500">Details</label>
                <div className="mt-1 p-3 bg-gray-50 border border-gray-200 rounded-md">
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-auto max-h-60">
                    {typeof selectedHistory.details === 'string' 
                      ? selectedHistory.details 
                      : JSON.stringify(selectedHistory.details, null, 2)
                    }
                  </pre>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-4">
              <Button onClick={() => setIsDetailsOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock } from "lucide-react";
import { Conflict } from "@shared/schema";
import { useResolveConflict, useDeleteConflict } from "@/hooks/use-conflicts";
import { useToast } from "@/hooks/use-toast";

interface ConflictResolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflict: Conflict | null;
}

export function ConflictResolutionModal({ isOpen, onClose, conflict }: ConflictResolutionModalProps) {
  const [isResolving, setIsResolving] = useState(false);
  const { toast } = useToast();
  const resolveConflict = useResolveConflict();
  const deleteConflict = useDeleteConflict();

  if (!conflict) return null;

  const handleResolve = async (resolution: "affinity" | "notion") => {
    setIsResolving(true);
    try {
      await resolveConflict.mutateAsync({ id: conflict.id, resolution });
      toast({
        title: "Conflict Resolved",
        description: `Conflict resolved using ${resolution} version`,
      });
      onClose();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to resolve conflict",
        variant: "destructive",
      });
    } finally {
      setIsResolving(false);
    }
  };

  const handleSkip = async () => {
    try {
      await deleteConflict.mutateAsync(conflict.id);
      toast({
        title: "Conflict Skipped",
        description: "Conflict has been skipped and removed from the queue",
      });
      onClose();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to skip conflict",
        variant: "destructive",
      });
    }
  };

  const formatValue = (value: any) => {
    if (value === null || value === undefined) return "Empty";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "Unknown";
    return new Date(date).toLocaleString();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Resolve Conflict">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-md font-medium text-gray-900">
            Conflicting Record: {conflict.recordId}
          </h4>
          <Badge variant="outline">
            <Clock className="h-3 w-3 mr-1" />
            {formatDate(conflict.createdAt)}
          </Badge>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2" />
            <span className="text-sm text-yellow-800">
              This record has been modified in both systems. Please choose which version to keep.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Affinity Version */}
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h5 className="font-medium text-gray-900 flex items-center">
                <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center mr-2">
                  <svg className="w-3 h-3 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                Affinity Version
              </h5>
              <span className="text-xs text-gray-500">
                {formatDate(conflict.affinityLastModified)}
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Field</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">
                  {conflict.fieldName}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Value</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">
                  {formatValue(conflict.affinityValue)}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Record Type</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">
                  {conflict.recordType}
                </p>
              </div>
            </div>

            <Button 
              className="w-full mt-4 bg-purple-600 hover:bg-purple-700"
              onClick={() => handleResolve("affinity")}
              disabled={isResolving}
            >
              Choose This Version
            </Button>
          </div>

          {/* Notion Version */}
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h5 className="font-medium text-gray-900 flex items-center">
                <div className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center mr-2">
                  <svg className="w-3 h-3 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                  </svg>
                </div>
                Notion Version
              </h5>
              <span className="text-xs text-gray-500">
                {formatDate(conflict.notionLastModified)}
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Field</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">
                  {conflict.fieldName}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Value</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">
                  {formatValue(conflict.notionValue)}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Record Type</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">
                  {conflict.recordType}
                </p>
              </div>
            </div>

            <Button 
              className="w-full mt-4 bg-gray-600 hover:bg-gray-700"
              onClick={() => handleResolve("notion")}
              disabled={isResolving}
            >
              Choose This Version
            </Button>
          </div>
        </div>

        <div className="flex justify-end space-x-3">
          <Button variant="outline" onClick={handleSkip}>
            Skip This Conflict
          </Button>
        </div>
      </div>
    </Modal>
  );
}

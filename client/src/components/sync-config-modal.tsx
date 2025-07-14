import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ArrowRight } from "lucide-react";
import { SyncPair } from "@shared/schema";
import { useCreateSyncPair, useUpdateSyncPair } from "@/hooks/use-sync-pairs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface SyncConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncPair?: SyncPair;
}

interface FieldMapping {
  affinityField: string;
  notionProperty: string;
  affinityFieldId?: number;
}

export function SyncConfigModal({ isOpen, onClose, syncPair }: SyncConfigModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    affinityListId: "",
    notionDatabaseId: "",
    syncDirection: "bidirectional",
    syncFrequency: 15,
  });
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [newMapping, setNewMapping] = useState<FieldMapping>({
    affinityField: "",
    notionProperty: "",
  });
  const [newPropertyName, setNewPropertyName] = useState("");
  const [newPropertyType, setNewPropertyType] = useState("rich_text");
  const [creatingProperty, setCreatingProperty] = useState(false);

  const { toast } = useToast();
  const createSyncPair = useCreateSyncPair();
  const updateSyncPair = useUpdateSyncPair();
  const queryClient = useQueryClient();

  const { data: affinityLists } = useQuery<any[]>({
    queryKey: ["/api/affinity/lists"],
  });

  const { data: notionDatabases } = useQuery<any[]>({
    queryKey: ["/api/notion/databases"],
  });

  const { data: affinityFields } = useQuery<any[]>({
    queryKey: ["/api/affinity/lists", formData.affinityListId, "fields"],
    enabled: !!formData.affinityListId,
  });

  const { data: notionDatabase } = useQuery<any>({
    queryKey: ["/api/notion/databases", formData.notionDatabaseId],
    enabled: !!formData.notionDatabaseId,
  });

  useEffect(() => {
    if (syncPair) {
      setFormData({
        name: syncPair.name,
        affinityListId: syncPair.affinityListId,
        notionDatabaseId: syncPair.notionDatabaseId,
        syncDirection: syncPair.syncDirection,
        syncFrequency: syncPair.syncFrequency,
      });
      setFieldMappings(syncPair.fieldMappings as FieldMapping[] || []);
      setStatusFilters(syncPair.statusFilters as string[] || []);
    } else {
      // Reset form for new sync pair
      setFormData({
        name: "",
        affinityListId: "",
        notionDatabaseId: "",
        syncDirection: "bidirectional",
        syncFrequency: 15,
      });
      setFieldMappings([]);
      setStatusFilters([]);
    }
  }, [syncPair, isOpen]);

  const handleAddMapping = () => {
    if (newMapping.affinityField && newMapping.notionProperty) {
      const affinityField = affinityFields?.find(f => f.name === newMapping.affinityField);
      setFieldMappings([
        ...fieldMappings,
        {
          ...newMapping,
          affinityFieldId: affinityField?.id,
        },
      ]);
      setNewMapping({ affinityField: "", notionProperty: "" });
    }
  };

  const handleRemoveMapping = (index: number) => {
    setFieldMappings(fieldMappings.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    try {
      const affinityList = affinityLists?.find(l => l.id.toString() === formData.affinityListId);
      const notionDb = notionDatabases?.find(d => d.id === formData.notionDatabaseId);

      if (!affinityList || !notionDb) {
        toast({
          title: "Error",
          description: "Please select both Affinity list and Notion database",
          variant: "destructive",
        });
        return;
      }

      const syncPairData = {
        ...formData,
        affinityListName: affinityList.name,
        notionDatabaseName: notionDb.title?.[0]?.text?.content || "Untitled Database",
        fieldMappings: fieldMappings,
        statusFilters: statusFilters,
      };

      if (syncPair) {
        await updateSyncPair.mutateAsync({ id: syncPair.id, data: syncPairData });
        toast({
          title: "Success",
          description: "Sync pair updated successfully",
        });
      } else {
        await createSyncPair.mutateAsync(syncPairData);
        toast({
          title: "Success",
          description: "Sync pair created successfully",
        });
      }

      onClose();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save sync pair",
        variant: "destructive",
      });
    }
  };

  const notionProperties = notionDatabase?.properties ? Object.keys(notionDatabase.properties) : [];
  
  // Get status field and its options from Affinity fields
  const statusField = affinityFields?.find(field => field.name.toLowerCase() === 'status');
  const statusOptions = statusField?.dropdown_options || [];

  const handleStatusToggle = (statusName: string) => {
    setStatusFilters(prev => 
      prev.includes(statusName) 
        ? prev.filter(s => s !== statusName)
        : [...prev, statusName]
    );
  };

  const handleCreateProperty = async () => {
    if (!newPropertyName || !formData.notionDatabaseId) return;

    setCreatingProperty(true);
    try {
      await apiRequest(
        "POST",
        `/api/notion/databases/${formData.notionDatabaseId}/properties`,
        {
          propertyName: newPropertyName,
          propertyType: newPropertyType,
        }
      );

      // Refresh the database info to get the new property
      await queryClient.invalidateQueries({
        queryKey: ["/api/notion/databases", formData.notionDatabaseId],
      });

      toast({
        title: "Success",
        description: `Property "${newPropertyName}" created successfully`,
      });

      // Clear the form
      setNewPropertyName("");
      setNewPropertyType("rich_text");
    } catch (error) {
      console.error("Error creating property:", error);
      toast({
        title: "Error",
        description: "Failed to create property",
        variant: "destructive",
      });
    } finally {
      setCreatingProperty(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={syncPair ? "Edit Sync Configuration" : "Create New Sync"}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Affinity Configuration */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h4 className="font-medium text-gray-900">Affinity Configuration</h4>
            </div>

            <div className="space-y-3">
              <div>
                <Label htmlFor="name">Sync Pair Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter sync pair name"
                />
              </div>

              <div>
                <Label htmlFor="affinityList">Select List</Label>
                <Select value={formData.affinityListId} onValueChange={(value) => setFormData({ ...formData, affinityListId: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an Affinity List" />
                  </SelectTrigger>
                  <SelectContent>
                    {affinityLists?.map((list) => (
                      <SelectItem key={list.id} value={list.id.toString()}>
                        {list.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Sync Direction</Label>
                <RadioGroup
                  value={formData.syncDirection}
                  onValueChange={(value) => setFormData({ ...formData, syncDirection: value })}
                  className="mt-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="bidirectional" id="bidirectional" />
                    <Label htmlFor="bidirectional" className="text-sm">
                      Bidirectional (recommended)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="affinity-to-notion" id="affinity-to-notion" />
                    <Label htmlFor="affinity-to-notion" className="text-sm">
                      Affinity → Notion only
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="notion-to-affinity" id="notion-to-affinity" />
                    <Label htmlFor="notion-to-affinity" className="text-sm">
                      Notion → Affinity only
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Status Filtering */}
              {statusOptions.length > 0 && (
                <div>
                  <Label>Status Filter</Label>
                  <p className="text-sm text-gray-500 mb-2">
                    Select which statuses to sync. Leave empty to sync all.
                  </p>
                  <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                    {statusOptions.map((option: any) => (
                      <div key={option.id} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={`status-${option.id}`}
                          checked={statusFilters.includes(option.text)}
                          onChange={() => handleStatusToggle(option.text)}
                          className="rounded border-gray-300"
                        />
                        <Label 
                          htmlFor={`status-${option.id}`} 
                          className="text-sm font-normal cursor-pointer"
                        >
                          {option.text}
                        </Label>
                      </div>
                    ))}
                  </div>
                  {statusFilters.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {statusFilters.map((status) => (
                        <Badge key={status} variant="secondary" className="text-xs">
                          {status}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Notion Configuration */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                </svg>
              </div>
              <h4 className="font-medium text-gray-900">Notion Configuration</h4>
            </div>

            <div className="space-y-3">
              <div>
                <Label htmlFor="notionDatabase">Select Database</Label>
                <Select value={formData.notionDatabaseId} onValueChange={(value) => setFormData({ ...formData, notionDatabaseId: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a Notion Database" />
                  </SelectTrigger>
                  <SelectContent>
                    {notionDatabases?.map((db) => (
                      <SelectItem key={db.id} value={db.id}>
                        {db.title?.[0]?.text?.content || "Untitled Database"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="syncFrequency">Sync Frequency</Label>
                <Select 
                  value={formData.syncFrequency.toString()} 
                  onValueChange={(value) => setFormData({ ...formData, syncFrequency: parseInt(value) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">Every 5 minutes</SelectItem>
                    <SelectItem value="15">Every 15 minutes</SelectItem>
                    <SelectItem value="30">Every 30 minutes</SelectItem>
                    <SelectItem value="60">Every hour</SelectItem>
                    <SelectItem value="1440">Daily</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* Field Mapping */}
        <div className="space-y-4">
          <h4 className="font-medium text-gray-900">Field Mapping</h4>
          
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <Label htmlFor="affinityField">Affinity Field</Label>
                <Select 
                  value={newMapping.affinityField} 
                  onValueChange={(value) => setNewMapping({ ...newMapping, affinityField: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select field" />
                  </SelectTrigger>
                  <SelectContent>
                    {affinityFields?.map((field) => (
                      <SelectItem key={field.id} value={field.name}>
                        {field.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="notionProperty">Notion Property</Label>
                <div className="space-y-2">
                  <Select 
                    value={newMapping.notionProperty} 
                    onValueChange={(value) => setNewMapping({ ...newMapping, notionProperty: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select property" />
                    </SelectTrigger>
                    <SelectContent>
                      {notionProperties.map((property) => (
                        <SelectItem key={property} value={property}>
                          {property}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  <div className="text-xs text-gray-500">
                    Or create a new property:
                  </div>
                  
                  <div className="flex gap-2">
                    <Input
                      placeholder="New property name"
                      value={newPropertyName}
                      onChange={(e) => setNewPropertyName(e.target.value)}
                      className="flex-1"
                    />
                    <Select 
                      value={newPropertyType} 
                      onValueChange={setNewPropertyType}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rich_text">Text</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="select">Select</SelectItem>
                        <SelectItem value="multi_select">Multi-select</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="checkbox">Checkbox</SelectItem>
                        <SelectItem value="url">URL</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      onClick={handleCreateProperty}
                      disabled={!newPropertyName || !formData.notionDatabaseId || creatingProperty}
                      className="bg-blue-600 hover:bg-blue-700"
                      size="sm"
                    >
                      {creatingProperty ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex items-end">
                <Button onClick={handleAddMapping} className="bg-green-600 hover:bg-green-700">
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            </div>

            {/* Existing Mappings */}
            <div className="space-y-2">
              {fieldMappings.map((mapping, index) => (
                <div key={index} className="flex items-center justify-between bg-white p-3 rounded border">
                  <div className="flex items-center space-x-4">
                    <Badge variant="outline">{mapping.affinityField}</Badge>
                    <ArrowRight className="h-4 w-4 text-gray-400" />
                    <Badge variant="outline">{mapping.notionProperty}</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveMapping(index)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {fieldMappings.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">
                  No field mappings configured yet. Add mappings above to sync data between fields.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={createSyncPair.isPending || updateSyncPair.isPending}
          >
            {syncPair ? "Update Configuration" : "Create Sync Pair"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

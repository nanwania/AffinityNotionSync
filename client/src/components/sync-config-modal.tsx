import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, ArrowRight, ArrowRightLeft } from "lucide-react";
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
  const [selectedFields, setSelectedFields] = useState<{[key: string]: string}>({});
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

  const { data: allAffinityFields } = useQuery<any>({
    queryKey: ["/api/affinity/lists", formData.affinityListId, "all-fields"],
    enabled: !!formData.affinityListId,
  });

  const { data: notionDatabase } = useQuery<any>({
    queryKey: ["/api/notion/databases", formData.notionDatabaseId],
    enabled: !!formData.notionDatabaseId,
  });

  const { data: statusOptions } = useQuery<any[]>({
    queryKey: ["/api/affinity/lists", formData.affinityListId, "status-options"],
    enabled: !!formData.affinityListId,
  });

  // Debug logging
  console.log("Status options debug:", {
    affinityListId: formData.affinityListId,
    statusOptions,
    statusOptionsLength: statusOptions?.length,
    enabled: !!formData.affinityListId
  });

  useEffect(() => {
    if (syncPair) {
      console.log("Loading existing sync pair:", syncPair);
      setFormData({
        name: syncPair.name,
        affinityListId: syncPair.affinityListId.toString(),
        notionDatabaseId: syncPair.notionDatabaseId,
        syncDirection: syncPair.syncDirection,
        syncFrequency: syncPair.syncFrequency,
      });
      setFieldMappings(syncPair.fieldMappings as FieldMapping[] || []);
      setStatusFilters(syncPair.statusFilters as string[] || []);
      
      // Convert existing field mappings to selectedFields format
      const selectedFieldsMap: {[key: string]: string} = {};
      (syncPair.fieldMappings as FieldMapping[] || []).forEach(mapping => {
        selectedFieldsMap[mapping.affinityField] = mapping.notionProperty;
      });
      setSelectedFields(selectedFieldsMap);
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
      setSelectedFields({});
    }
  }, [syncPair, isOpen]);

  const handleFieldToggle = (affinityFieldName: string, checked: boolean) => {
    if (checked) {
      // Default to same name for Notion property
      const defaultNotionProperty = notionProperties.includes(affinityFieldName) 
        ? affinityFieldName 
        : notionProperties[0] || '';
      setSelectedFields(prev => ({
        ...prev,
        [affinityFieldName]: defaultNotionProperty
      }));
    } else {
      setSelectedFields(prev => {
        const newFields = { ...prev };
        delete newFields[affinityFieldName];
        return newFields;
      });
    }
  };

  // Map Affinity field types to Notion property types
  const mapAffinityToNotionType = (affinityField: any): string => {
    if (!affinityField?.value_type) return "rich_text";
    
    switch (affinityField.value_type) {
      case 1: // Text/String
      case 6: // Long text/Description
        return "rich_text";
      case 2: // Dropdown (single or multi)
        return affinityField.allows_multiple ? "multi_select" : "select";
      case 3: // Number
        return "number";
      case 4: // Date
        return "date";
      case 5: // Location/Address
        return "rich_text";
      case 7: // Person
        return "relation";
      case 8: // Organization
        return "url"; // Organizations should link to their domains
      case 9: // URL
        return "url";
      case 10: // Email
        return "email";
      case 11: // Phone
        return "phone_number";
      default:
        return "rich_text";
    }
  };

  const handleNotionPropertyChange = async (affinityFieldName: string, notionProperty: string) => {
    // Check if user selected "Create new property"
    if (notionProperty === "__CREATE_NEW__") {
      // Find the affinity field data to determine appropriate type
      let affinityFieldData = null;
      
      // Search through all field categories to find the field data
      if (allAffinityFields) {
        const allFields = [
          ...(allAffinityFields.virtual || []),
          ...(allAffinityFields.global || []),
          ...(allAffinityFields.list || []),
          ...(allAffinityFields.person || []),
          ...(allAffinityFields.organization || []),
          ...(allAffinityFields.opportunity || [])
        ];
        affinityFieldData = allFields.find(f => f.name === affinityFieldName);
      }
      
      const propertyType = mapAffinityToNotionType(affinityFieldData);
      
      try {
        setCreatingProperty(true);
        await apiRequest(
          "POST",
          `/api/notion/databases/${formData.notionDatabaseId}/properties`,
          {
            propertyName: affinityFieldName,
            propertyType: propertyType,
          }
        );

        // Refresh the database info to get the new property
        await queryClient.invalidateQueries({
          queryKey: ["/api/notion/databases", formData.notionDatabaseId],
        });

        toast({
          title: "Success",
          description: `Property "${affinityFieldName}" created successfully`,
        });

        // Set the newly created property as selected
        setSelectedFields(prev => ({
          ...prev,
          [affinityFieldName]: affinityFieldName
        }));
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
    } else {
      setSelectedFields(prev => ({
        ...prev,
        [affinityFieldName]: notionProperty
      }));
    }
  };

  // Convert selectedFields to fieldMappings format for submission
  const getFieldMappings = (): FieldMapping[] => {
    return Object.entries(selectedFields).map(([affinityField, notionProperty]) => {
      // Handle virtual fields with negative IDs
      const virtualFields: {[key: string]: number} = {
        "Organization ID": -7,
        "Entity Name": -1,
        "Entity Type": -3,
        "Entity Domain": -2,
        "Name": -4,
        "Opportunity ID": -5,
        "Organization Name": -6
      };
      
      const affinityFieldData = affinityFields?.find(f => f.name === affinityField);
      const fieldId = virtualFields[affinityField] || affinityFieldData?.id;
      
      return {
        affinityField,
        notionProperty,
        affinityFieldId: fieldId,
      };
    });
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
        fieldMappings: getFieldMappings(),
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
              <h4 className="font-medium text-foreground">Affinity Configuration</h4>
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
              <div>
                <Label>Status Filter</Label>
                <p className="text-sm text-gray-500 mb-2">
                  Select which statuses to sync. Leave empty to sync all.
                </p>
                {!formData.affinityListId ? (
                  <p className="text-sm text-gray-400 italic">Select an Affinity list first to see status options</p>
                ) : statusOptions && statusOptions.length > 0 ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                      {statusOptions?.map((option: any) => (
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
                  </>
                ) : (
                  <p className="text-sm text-gray-400 italic">Loading status options...</p>
                )}
                </div>
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
              <h4 className="font-medium text-foreground">Notion Configuration</h4>
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

        {/* Field Mapping - Checkbox Interface */}
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <ArrowRightLeft className="h-5 w-5 text-blue-600" />
            <h4 className="font-medium text-foreground">Field Mapping</h4>
          </div>
          <p className="text-sm text-gray-600">
            Select the Affinity fields you want to sync and choose their corresponding Notion properties.
          </p>
          
          {!formData.affinityListId || !formData.notionDatabaseId ? (
            <div className="bg-muted rounded-lg p-6 text-center">
              <p className="text-sm text-gray-500">
                Please select both an Affinity list and Notion database first to configure field mappings.
              </p>
            </div>
          ) : !affinityFields || affinityFields.length === 0 ? (
            <div className="bg-muted rounded-lg p-6 text-center">
              <p className="text-sm text-gray-500">Loading field options...</p>
            </div>
          ) : (
            <div className="bg-muted rounded-lg p-4">
              {/* Create New Notion Property Section */}
              <div className="mb-6 p-4 bg-background rounded-lg border border-dashed border-gray-300">
                <Label className="text-sm font-medium mb-2 block">Create New Notion Property</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Property name"
                    value={newPropertyName}
                    onChange={(e) => setNewPropertyName(e.target.value)}
                    className="flex-1"
                  />
                  <Select value={newPropertyType} onValueChange={setNewPropertyType}>
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

              {/* Field Selection Grid */}
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-4 text-sm font-medium text-gray-700 border-b pb-2">
                  <div>Sync</div>
                  <div>Affinity Field</div>
                  <div>→ Notion Property</div>
                </div>
                
                <div className="space-y-4 max-h-80 overflow-y-auto">
                  {/* Use comprehensive field data if available, otherwise fallback to simple fields */}
                  {allAffinityFields ? (
                    <>
                      {/* Virtual Fields Section */}
                      <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                        <p className="text-xs font-medium text-blue-800 mb-2">Virtual Fields (Auto-generated)</p>
                        {allAffinityFields.virtual?.map((field: any) => {
                          const isSelected = selectedFields.hasOwnProperty(field.name);
                          return (
                            <div key={field.id} className="grid grid-cols-3 gap-4 items-center py-1 border-b border-blue-100 last:border-b-0">
                              <div className="flex items-center">
                                <Checkbox
                                  id={`virtual-${field.id}`}
                                  checked={isSelected}
                                  onCheckedChange={(checked) => handleFieldToggle(field.name, !!checked)}
                                />
                              </div>
                              
                              <div className="flex items-center space-x-2">
                                <Badge variant="outline" className="text-xs border-blue-300 text-blue-700">
                                  {field.name}
                                </Badge>
                              </div>
                              
                              <div>
                                {isSelected ? (
                                  <Select
                                    value={selectedFields[field.name] || ''}
                                    onValueChange={(value) => handleNotionPropertyChange(field.name, value)}
                                  >
                                    <SelectTrigger className="h-8">
                                      <SelectValue placeholder="Select property" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {notionProperties.map((property) => (
                                        <SelectItem key={property} value={property}>
                                          {property}
                                        </SelectItem>
                                      ))}
                                      <SelectItem value="__CREATE_NEW__" className="text-blue-600 font-medium">
                                        ➕ Create new property "{field.name}"
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <span className="text-xs text-blue-500">{field.entity_type} field</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Global Fields Section */}
                      {allAffinityFields.global && allAffinityFields.global.length > 0 && (
                        <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                          <p className="text-xs font-medium text-green-800 mb-2">Global Fields (All Entities)</p>
                          {allAffinityFields.global.map((field: any) => {
                            const isSelected = selectedFields.hasOwnProperty(field.name);
                            return (
                              <div key={field.id} className="grid grid-cols-3 gap-4 items-center py-1 border-b border-green-100 last:border-b-0">
                                <div className="flex items-center">
                                  <Checkbox
                                    id={`global-${field.id}`}
                                    checked={isSelected}
                                    onCheckedChange={(checked) => handleFieldToggle(field.name, !!checked)}
                                  />
                                </div>
                                
                                <div className="flex items-center space-x-2">
                                  <Badge variant="outline" className="text-xs border-green-300 text-green-700">
                                    {field.name}
                                  </Badge>
                                </div>
                                
                                <div>
                                  {isSelected ? (
                                    <Select
                                      value={selectedFields[field.name] || ''}
                                      onValueChange={(value) => handleNotionPropertyChange(field.name, value)}
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue placeholder="Select property" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {notionProperties.map((property) => (
                                          <SelectItem key={property} value={property}>
                                            {property}
                                          </SelectItem>
                                        ))}
                                        <SelectItem value="__CREATE_NEW__" className="text-blue-600 font-medium">
                                          ➕ Create new property "{field.name}"
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <span className="text-xs text-green-500">Global field</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* List-Specific Fields Section */}
                      {allAffinityFields.list && allAffinityFields.list.length > 0 && (
                        <div className="bg-purple-50 p-3 rounded-lg border border-purple-200">
                          <p className="text-xs font-medium text-purple-800 mb-2">List-Specific Fields</p>
                          {allAffinityFields.list.map((field: any) => {
                            const isSelected = selectedFields.hasOwnProperty(field.name);
                            return (
                              <div key={field.id} className="grid grid-cols-3 gap-4 items-center py-1 border-b border-purple-100 last:border-b-0">
                                <div className="flex items-center">
                                  <Checkbox
                                    id={`list-${field.id}`}
                                    checked={isSelected}
                                    onCheckedChange={(checked) => handleFieldToggle(field.name, !!checked)}
                                  />
                                </div>
                                
                                <div className="flex items-center space-x-2">
                                  <Badge variant="outline" className="text-xs border-purple-300 text-purple-700">
                                    {field.name}
                                  </Badge>
                                </div>
                                
                                <div>
                                  {isSelected ? (
                                    <Select
                                      value={selectedFields[field.name] || ''}
                                      onValueChange={(value) => handleNotionPropertyChange(field.name, value)}
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue placeholder="Select property" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {notionProperties.map((property) => (
                                          <SelectItem key={property} value={property}>
                                            {property}
                                          </SelectItem>
                                        ))}
                                        <SelectItem value="__CREATE_NEW__" className="text-blue-600 font-medium">
                                          ➕ Create new property "{field.name}"
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <span className="text-xs text-purple-500">List field</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Person Fields Section */}
                      {allAffinityFields.person && allAffinityFields.person.length > 0 && (
                        <div className="bg-orange-50 p-3 rounded-lg border border-orange-200">
                          <p className="text-xs font-medium text-orange-800 mb-2">Person Fields</p>
                          {allAffinityFields.person.map((field: any) => {
                            const isSelected = selectedFields.hasOwnProperty(field.name);
                            return (
                              <div key={field.id} className="grid grid-cols-3 gap-4 items-center py-1 border-b border-orange-100 last:border-b-0">
                                <div className="flex items-center">
                                  <Checkbox
                                    id={`person-${field.id}`}
                                    checked={isSelected}
                                    onCheckedChange={(checked) => handleFieldToggle(field.name, !!checked)}
                                  />
                                </div>
                                
                                <div className="flex items-center space-x-2">
                                  <Badge variant="outline" className="text-xs border-orange-300 text-orange-700">
                                    {field.name}
                                  </Badge>
                                </div>
                                
                                <div>
                                  {isSelected ? (
                                    <Select
                                      value={selectedFields[field.name] || ''}
                                      onValueChange={(value) => handleNotionPropertyChange(field.name, value)}
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue placeholder="Select property" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {notionProperties.map((property) => (
                                          <SelectItem key={property} value={property}>
                                            {property}
                                          </SelectItem>
                                        ))}
                                        <SelectItem value="__CREATE_NEW__" className="text-blue-600 font-medium">
                                          ➕ Create new property "{field.name}"
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <span className="text-xs text-orange-500">Person field</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Organization Fields Section */}
                      {allAffinityFields.organization && allAffinityFields.organization.length > 0 && (
                        <div className="bg-teal-50 p-3 rounded-lg border border-teal-200">
                          <p className="text-xs font-medium text-teal-800 mb-2">Organization Fields</p>
                          {allAffinityFields.organization.map((field: any) => {
                            const isSelected = selectedFields.hasOwnProperty(field.name);
                            return (
                              <div key={field.id} className="grid grid-cols-3 gap-4 items-center py-1 border-b border-teal-100 last:border-b-0">
                                <div className="flex items-center">
                                  <Checkbox
                                    id={`org-${field.id}`}
                                    checked={isSelected}
                                    onCheckedChange={(checked) => handleFieldToggle(field.name, !!checked)}
                                  />
                                </div>
                                
                                <div className="flex items-center space-x-2">
                                  <Badge variant="outline" className="text-xs border-teal-300 text-teal-700">
                                    {field.name}
                                  </Badge>
                                </div>
                                
                                <div>
                                  {isSelected ? (
                                    <Select
                                      value={selectedFields[field.name] || ''}
                                      onValueChange={(value) => handleNotionPropertyChange(field.name, value)}
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue placeholder="Select property" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {notionProperties.map((property) => (
                                          <SelectItem key={property} value={property}>
                                            {property}
                                          </SelectItem>
                                        ))}
                                        <SelectItem value="__CREATE_NEW__" className="text-blue-600 font-medium">
                                          ➕ Create new property "{field.name}"
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <span className="text-xs text-teal-500">Organization field</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Opportunity Fields Section */}
                      {allAffinityFields.opportunity && allAffinityFields.opportunity.length > 0 && (
                        <div className="bg-pink-50 p-3 rounded-lg border border-pink-200">
                          <p className="text-xs font-medium text-pink-800 mb-2">Opportunity Fields</p>
                          {allAffinityFields.opportunity.map((field: any) => {
                            const isSelected = selectedFields.hasOwnProperty(field.name);
                            return (
                              <div key={field.id} className="grid grid-cols-3 gap-4 items-center py-1 border-b border-pink-100 last:border-b-0">
                                <div className="flex items-center">
                                  <Checkbox
                                    id={`opp-${field.id}`}
                                    checked={isSelected}
                                    onCheckedChange={(checked) => handleFieldToggle(field.name, !!checked)}
                                  />
                                </div>
                                
                                <div className="flex items-center space-x-2">
                                  <Badge variant="outline" className="text-xs border-pink-300 text-pink-700">
                                    {field.name}
                                  </Badge>
                                </div>
                                
                                <div>
                                  {isSelected ? (
                                    <Select
                                      value={selectedFields[field.name] || ''}
                                      onValueChange={(value) => handleNotionPropertyChange(field.name, value)}
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue placeholder="Select property" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {notionProperties.map((property) => (
                                          <SelectItem key={property} value={property}>
                                            {property}
                                          </SelectItem>
                                        ))}
                                        <SelectItem value="__CREATE_NEW__" className="text-blue-600 font-medium">
                                          ➕ Create new property "{field.name}"
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <span className="text-xs text-pink-500">Opportunity field</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    /* Fallback to simple fields if comprehensive data not available */
                    affinityFields?.map((field) => {
                      const isSelected = selectedFields.hasOwnProperty(field.name);
                      return (
                        <div key={field.id} className="grid grid-cols-3 gap-4 items-center py-2 border-b border-gray-100">
                          <div className="flex items-center">
                            <Checkbox
                              id={`field-${field.id}`}
                              checked={isSelected}
                              onCheckedChange={(checked) => handleFieldToggle(field.name, !!checked)}
                            />
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <Badge variant="secondary" className="text-xs">
                              {field.name}
                            </Badge>
                          </div>
                          
                          <div>
                            {isSelected ? (
                              <Select
                                value={selectedFields[field.name] || ''}
                                onValueChange={(value) => handleNotionPropertyChange(field.name, value)}
                              >
                                <SelectTrigger className="h-8">
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
                            ) : (
                              <span className="text-sm text-gray-400">Select field first</span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                
                {Object.keys(selectedFields).length > 0 && (
                  <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
                    <p className="text-sm font-medium text-green-800 mb-2">
                      Selected Mappings ({Object.keys(selectedFields).length}):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(selectedFields).map(([affinityField, notionProperty]) => (
                        <div key={affinityField} className="flex items-center space-x-1 text-xs bg-white px-2 py-1 rounded border">
                          <span className="text-blue-600">{affinityField}</span>
                          <ArrowRight className="h-3 w-3 text-gray-400" />
                          <span className="text-green-600">{notionProperty}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
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

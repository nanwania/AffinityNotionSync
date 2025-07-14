import axios, { AxiosInstance } from 'axios';

export interface AffinityList {
  id: number;
  name: string;
  type: number;
  public: boolean;
  owner_id: number;
  list_size: number;
}

export interface AffinityListEntry {
  id: number;
  list_id: number;
  creator_id: number;
  entity_id: number;
  entity_type: number;
  created_at: string;
  entity: {
    id: number;
    name: string;
    type?: number;
    first_name?: string;
    last_name?: string;
    primary_email?: string;
    emails?: string[];
    domain?: string;
    domains?: string[];
  };
}

export interface AffinityField {
  id: number;
  name: string;
  list_id?: number;
  value_type: number;
  allows_multiple: boolean;
  track_changes: boolean;
}

export interface AffinityFieldValue {
  id: number;
  field_id: number;
  list_entry_id: number;
  entity_type: number;
  value_type: number;
  entity_id: number;
  value: any;
}

export interface AffinityPerson {
  id: number;
  type: number;
  first_name: string;
  last_name: string;
  primary_email: string;
  emails: string[];
}

export interface AffinityOrganization {
  id: number;
  name: string;
  domain: string;
  domains: string[];
  person_ids: number[];
}

export class AffinityService {
  private client: AxiosInstance;

  constructor() {
    const apiKey = process.env.AFFINITY_API_KEY;
    if (!apiKey) {
      throw new Error('AFFINITY_API_KEY environment variable is required');
    }

    this.client = axios.create({
      baseURL: 'https://api.affinity.co',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async getLists(): Promise<AffinityList[]> {
    const response = await this.client.get('/v2/lists');
    return response.data.data || response.data;
  }

  async getList(listId: number): Promise<AffinityList> {
    const response = await this.client.get(`/v2/lists/${listId}`);
    return response.data;
  }

  async getListEntries(listId: number, cursor?: string): Promise<{ entries: AffinityListEntry[], nextUrl?: string }> {
    // Get list fields first to include them in the request
    const listFields = await this.getFields(listId);
    const fieldIds = listFields.map(f => f.id);
    
    const params: any = { 
      fieldIds: fieldIds.join(',') // Include all list fields
    };
    if (cursor) {
      params.cursor = cursor;
    }

    const response = await this.client.get(`/v2/lists/${listId}/list-entries`, { params });
    
    return {
      entries: response.data.data || [],
      nextUrl: response.data.pagination?.nextUrl
    };
  }

  async getAllListEntries(listId: number, statusFilters?: string[]): Promise<AffinityListEntry[]> {
    const allEntries: AffinityListEntry[] = [];
    let nextUrl: string | undefined;
    let pageCount = 0;
    
    // Pre-filter optimization
    const shouldFilter = statusFilters && statusFilters.length > 0;
    let statusFieldId: string | undefined;
    
    if (shouldFilter) {
      const fields = await this.getFields(listId);
      const statusField = fields.find(f => f.name.toLowerCase() === 'status');
      // The fields API already returns IDs with 'field-' prefix for most fields
      statusFieldId = statusField ? statusField.id : undefined;
      console.log(`Optimized filtering enabled for status field: ${statusField?.name} (looking for field ID: ${statusFieldId})`);
    }

    console.log(`Fetching entries for list ${listId}${shouldFilter ? ` with status filters: [${statusFilters.join(', ')}]` : ''}`);

    do {
      pageCount++;
      
      let result;
      if (nextUrl) {
        // Use the full nextUrl directly for pagination
        // Parse the nextUrl to get the path and params
        const url = new URL(nextUrl);
        const response = await this.client.get(url.pathname + url.search);
        
        result = {
          entries: response.data.data || [],
          nextUrl: response.data.pagination?.nextUrl
        };
      } else {
        result = await this.getListEntries(listId);
      }
      
      // If filtering is enabled, filter entries as we fetch them
      if (shouldFilter && statusFieldId) {
        const matchingEntries = result.entries.filter((entry, index) => {
          const entityFields = entry.entity?.fields || [];
          const statusField = entityFields.find(f => f.id === statusFieldId);
          
          // Debug first entry to understand the data structure
          if (pageCount === 1 && index === 0) {
            console.log(`DEBUG: Entity ID ${entry.entity?.id}, looking for field ${statusFieldId}`);
            console.log(`  Available field IDs: [${entityFields.map(f => f.id).slice(0, 8).join(', ')}]`);
            const statusFieldFound = entityFields.find(f => f.name?.toLowerCase() === 'status');
            console.log(`  Status field found by name: ${!!statusFieldFound}, ID: ${statusFieldFound?.id}, value: ${statusFieldFound?.value?.data?.text}`);
            console.log(`  Target filters: [${statusFilters!.join(', ')}]`);
            console.log(`  Match would be: ${statusFieldFound?.value?.data?.text && statusFilters!.includes(statusFieldFound.value.data.text)}`);
          }
          
          return statusField?.value?.data?.text && statusFilters!.includes(statusField.value.data.text);
        });
        allEntries.push(...matchingEntries);
        console.log(`Page ${pageCount}: ${result.entries.length} entries, ${matchingEntries.length} match filters. Total filtered: ${allEntries.length}`);
      } else {
        allEntries.push(...result.entries);
        console.log(`Page ${pageCount}: Got ${result.entries.length} entries. Total so far: ${allEntries.length}`);
      }
      
      nextUrl = result.nextUrl;
    } while (nextUrl);

    console.log(`Finished fetching ${shouldFilter ? 'and filtering ' : ''}entries. Total: ${allEntries.length} entries across ${pageCount} pages`);
    return allEntries;
  }

  async getEnrichedListEntries(listId: number): Promise<any[]> {
    const entries = await this.getAllListEntries(listId);
    const enrichedEntries = [];

    for (const entry of entries) {
      let enrichedEntry = { ...entry };
      
      // If entity is an organization (type 1), fetch additional org details
      if (entry.entity_type === 1) {
        try {
          const orgDetails = await this.getOrganization(entry.entity_id);
          enrichedEntry.organization = orgDetails;
        } catch (error) {
          console.warn(`Could not fetch organization details for ${entry.entity_id}:`, error);
        }
      }
      
      // If entity is a person (type 0), fetch additional person details  
      if (entry.entity_type === 0) {
        try {
          const personDetails = await this.getPerson(entry.entity_id);
          enrichedEntry.person = personDetails;
        } catch (error) {
          console.warn(`Could not fetch person details for ${entry.entity_id}:`, error);
        }
      }

      enrichedEntries.push(enrichedEntry);
    }

    return enrichedEntries;
  }

  async getFields(listId?: number): Promise<AffinityField[]> {
    if (listId) {
      const response = await this.client.get(`/v2/lists/${listId}/fields`);
      return response.data.data || response.data;
    } else {
      const response = await this.client.get('/v2/fields');
      return response.data.data || response.data;
    }
  }

  // Get all field types for comprehensive field mapping
  async getAllFieldTypes(listId?: number): Promise<{
    globalFields: AffinityField[];
    listFields: AffinityField[];
    personFields: AffinityField[];
    organizationFields: AffinityField[];
    opportunityFields: AffinityField[];
  }> {
    try {
      if (!listId) {
        return {
          globalFields: [],
          listFields: [],
          personFields: [],
          organizationFields: [],
          opportunityFields: []
        };
      }

      // Get all fields available for this list  
      const allListFields = await this.getFields(listId);
      console.log(`Found ${allListFields.length} total fields for list ${listId}`);
      
      // Categorize fields based on their actual structure from the Affinity API
      const listFields: AffinityField[] = [];
      const personFields: AffinityField[] = [];
      const organizationFields: AffinityField[] = [];
      const opportunityFields: AffinityField[] = [];
      const globalFields: AffinityField[] = [];
      
      for (const field of allListFields) {
        // Skip virtual fields (negative IDs) - they're handled separately
        if (typeof field.id === 'number' && field.id < 0) continue;
        
        const fieldData = {
          id: field.id,
          name: field.name,
          value_type: this.mapValueType(field.valueType || field.value_type || 1),
          allows_multiple: field.allows_multiple || false,
          track_changes: field.track_changes || false
        };
        
        // Based on the API response structure and field analysis:
        // - type: "list" = custom opportunity fields for this specific list
        // - type: "relationship-intelligence" = global smart fields 
        // - valueType: "person-multi" or id: "persons" = person fields
        // - valueType: "company-multi" or id: "companies" = organization fields
        
        if (field.type === 'list') {
          // Custom fields specific to this opportunity list
          opportunityFields.push(fieldData);
        } else if (field.type === 'relationship-intelligence') {
          // Global relationship intelligence fields (Last Contact, First Email, etc.)
          globalFields.push(fieldData);
        } else if (field.valueType === 'person-multi' || field.id === 'persons') {
          // Fields that link to person entities
          personFields.push(fieldData);
        } else if (field.valueType === 'company-multi' || field.id === 'companies') {
          // Fields that link to organization entities
          organizationFields.push(fieldData);
        }
      }
      
      // Additionally, get embedded fields from actual entities to find entity-specific fields
      // These would be fields that exist on person/organization/opportunity entities themselves
      console.log('Analyzing sample entries to discover entity-specific fields...');
      const sampleEntries = await this.getListEntries(listId);
      const entries = sampleEntries.entries.slice(0, 50); // Increase sample for better coverage
      
      const entitySpecificFields = new Map<string, any>();
      const organizationIds = new Set<number>();
      const personIds = new Set<number>();
      
      // First pass: collect entity IDs and embedded fields from opportunity entries
      for (const entry of entries) {
        // Debug first few entries to understand structure
        if (organizationIds.size === 0 && personIds.size === 0) {
          console.log(`Entry structure sample:`, {
            id: entry.id,
            entity_type: entry.entity_type,
            entity_keys: entry.entity ? Object.keys(entry.entity) : [],
            has_companies: !!entry.entity?.companies,
            has_persons: !!entry.entity?.persons,
            companies_length: entry.entity?.companies?.length || 0,
            persons_length: entry.entity?.persons?.length || 0
          });
        }
        
        // Check for embedded fields in the main entity
        if (entry.entity?.fields && Array.isArray(entry.entity.fields)) {
          for (const embeddedField of entry.entity.fields) {
            const fieldKey = embeddedField.id.toString();
            
            // Skip if we already have this field from the main list
            const existsInMainList = allListFields.some(f => f.id.toString() === fieldKey);
            if (existsInMainList) continue;
            
            if (!entitySpecificFields.has(fieldKey)) {
              entitySpecificFields.set(fieldKey, {
                field: embeddedField,
                entityTypes: new Set([entry.entity_type]),
                count: 1
              });
            } else {
              const existing = entitySpecificFields.get(fieldKey)!;
              existing.entityTypes.add(entry.entity_type);
              existing.count++;
            }
          }
        }
        
        // Look for organization IDs in field values - this is where the actual linked data is
        if (entry.entity?.fields && Array.isArray(entry.entity.fields)) {
          for (const field of entry.entity.fields) {
            // Check for organization references in field values
            if (field.value?.data && Array.isArray(field.value.data)) {
              for (const item of field.value.data) {
                if (item.id && item.name && item.domain) {
                  // This looks like an organization reference
                  organizationIds.add(item.id);
                }
                if (item.id && item.first_name) {
                  // This looks like a person reference
                  personIds.add(item.id);
                }
              }
            }
            // Also check single organization/person references
            if (field.value?.data?.id) {
              if (field.value.data.domain || field.value.data.name) {
                organizationIds.add(field.value.data.id);
              }
              if (field.value.data.first_name) {
                personIds.add(field.value.data.id);
              }
            }
          }
        }
      }
      
      // Second pass: fetch actual organization entities to get their fields
      // Since the embedded approach may not capture all organization IDs, also try known ones
      const knownOrgIds = [296778106, 65914191]; // Klura, Owkin from previous sync work
      const allOrgIds = new Set([...organizationIds, ...knownOrgIds]);
      
      console.log(`Found ${organizationIds.size} unique organizations from entries, plus ${knownOrgIds.length} known organizations. Total: ${allOrgIds.size} to analyze for fields`);
      const orgSample = Array.from(allOrgIds).slice(0, 10); // Sample 10 organizations
      
      // Try to get organization fields using API v1 approach
      try {
        console.log('Attempting to fetch organization fields via API v1...');
        const orgGlobalFields = await this.getOrganizationFields();
        console.log(`Found ${orgGlobalFields.length} global organization fields`);
        
        for (const orgField of orgGlobalFields) {
          const fieldData = {
            id: orgField.id,
            name: orgField.name,
            value_type: orgField.value_type,
            allows_multiple: orgField.allows_multiple || false,
            track_changes: orgField.track_changes || false,
            field_type: 'organization',
            entity_type: 'organization'
          };
          organizationFields.push(fieldData);
        }
      } catch (error) {
        console.warn('Organization fields via API v1 not available:', error.message);
      }
      
      // Alternative: try fetching a few organizations that might work
      for (const orgId of orgSample.slice(0, 3)) {
        try {
          const org = await this.getOrganization(orgId);
          if (org.fields && Array.isArray(org.fields)) {
            console.log(`Organization ${orgId} has ${org.fields.length} fields`);
            for (const orgField of org.fields) {
              const fieldKey = orgField.id.toString();
              
              // Skip if already captured
              const existsInMainList = allListFields.some(f => f.id.toString() === fieldKey);
              if (existsInMainList) continue;
              
              if (!entitySpecificFields.has(fieldKey)) {
                entitySpecificFields.set(fieldKey, {
                  field: orgField,
                  entityTypes: new Set([1]), // Organization entity type
                  count: 1,
                  sourceEntity: 'organization'
                });
              } else {
                const existing = entitySpecificFields.get(fieldKey)!;
                existing.entityTypes.add(1);
                existing.count++;
              }
            }
          }
        } catch (error) {
          console.warn(`Could not fetch organization ${orgId}:`, error.message);
        }
      }
      
      // Third pass: fetch person fields using global endpoint and individual entities
      console.log(`Found ${personIds.size} unique persons to analyze for fields`);
      
      // Try global person fields endpoint first
      try {
        console.log('Attempting to fetch global person fields...');
        const personGlobalFields = await this.getPersonFields();
        console.log(`Found ${personGlobalFields.length} global person fields`);
        
        for (const personField of personGlobalFields) {
          // Map API v2 valueType to our internal value_type system
          let value_type = 1; // Default to text
          switch (personField.valueType) {
            case 'text': 
            case 'filterable-text':
              value_type = 1; 
              break;
            case 'number': 
              value_type = 2; 
              break;
            case 'datetime': 
              value_type = 3; 
              break;
            case 'dropdown': 
              value_type = 5; 
              break;
            case 'dropdown-multi': 
            case 'filterable-text-multi':
              value_type = 6; 
              break;
            case 'company': 
            case 'company-multi':
              value_type = 8; 
              break;
            case 'person': 
              value_type = 7; 
              break;
            case 'interaction': 
              value_type = 9; 
              break;
            case 'location': 
              value_type = 10; 
              break;
            default: 
              value_type = 1;
          }
          
          const fieldData = {
            id: personField.id,
            name: personField.name,
            value_type: value_type,
            allows_multiple: personField.valueType?.includes('multi') || false,
            track_changes: false,
            field_type: 'person',
            entity_type: 'person'
          };
          personFields.push(fieldData);
        }
      } catch (error) {
        console.warn('Global person fields not available:', error.message);
      }
      
      // Alternative: try fetching a few persons that might work
      const personSample = Array.from(personIds).slice(0, 3); // Sample 3 persons
      for (const personId of personSample) {
        try {
          const person = await this.getPerson(personId);
          if (person.fields && Array.isArray(person.fields)) {
            console.log(`Person ${personId} has ${person.fields.length} fields`);
            for (const personField of person.fields) {
              const fieldKey = personField.id.toString();
              
              // Skip if already captured
              const existsInMainList = allListFields.some(f => f.id.toString() === fieldKey);
              if (existsInMainList) continue;
              
              if (!entitySpecificFields.has(fieldKey)) {
                entitySpecificFields.set(fieldKey, {
                  field: personField,
                  entityTypes: new Set([0]), // Person entity type
                  count: 1,
                  sourceEntity: 'person'
                });
              } else {
                const existing = entitySpecificFields.get(fieldKey)!;
                existing.entityTypes.add(0);
                existing.count++;
              }
            }
          }
        } catch (error) {
          console.warn(`Could not fetch person ${personId}:`, error.message);
        }
      }
      
      // Add entity-specific fields to appropriate categories
      for (const [fieldId, fieldInfo] of entitySpecificFields) {
        const field = fieldInfo.field;
        const entityTypes = Array.from(fieldInfo.entityTypes);
        
        const fieldData = {
          id: field.id,
          name: field.name,
          value_type: this.inferValueType(field.value),
          allows_multiple: field.allows_multiple || false,
          track_changes: field.track_changes || false
        };
        
        // Based on Affinity entity types: 0=Person, 1=Organization, 8=Opportunity
        if (entityTypes.includes(0)) { // Person entity fields
          personFields.push({...fieldData, entity_source: 'person'});
        }
        if (entityTypes.includes(1)) { // Organization entity fields
          organizationFields.push({...fieldData, entity_source: 'organization'});
        }
        if (entityTypes.includes(8)) { // Opportunity entity fields
          opportunityFields.push({...fieldData, entity_source: 'opportunity'});
        }
        
        // If field appears in multiple entity types, also add to global
        if (entityTypes.length > 1) {
          globalFields.push({...fieldData, entity_source: 'multi-entity'});
        }
      }

      console.log(`Categorized fields: ${opportunityFields.length} opportunity, ${personFields.length} person, ${organizationFields.length} organization, ${globalFields.length} global`);
      console.log(`Found ${entitySpecificFields.size} additional entity-specific fields`);
      
      return {
        globalFields,
        listFields,
        personFields,
        organizationFields,
        opportunityFields
      };
    } catch (error) {
      console.error('Error fetching all field types:', error);
      // Return empty arrays to prevent crashes
      return {
        globalFields: [],
        listFields: [],
        personFields: [],
        organizationFields: [],
        opportunityFields: []
      };
    }
  }

  async getPersonFields(): Promise<AffinityField[]> {
    try {
      const response = await this.client.get('/v2/persons/fields');
      return response.data.data || response.data;
    } catch (error) {
      console.warn('Person fields endpoint not available:', error);
      return [];
    }
  }

  async getOrganizationFields(): Promise<AffinityField[]> {
    try {
      // Get all global fields via API v1, then filter for organization-specific fields
      const response = await this.client.get('/fields', {
        auth: {
          username: '',
          password: process.env.AFFINITY_API_KEY || ''
        },
        baseURL: 'https://api.affinity.co'
      });
      
      const allFields = response.data || [];
      const organizationFields: AffinityField[] = [];
      
      // Get field values for a sample organization to identify which fields are organization-specific
      const orgFieldValuesResponse = await this.client.get('/field-values?organization_id=296778106', {
        auth: {
          username: '',
          password: process.env.AFFINITY_API_KEY || ''
        },
        baseURL: 'https://api.affinity.co'
      });
      
      const orgFieldValues = orgFieldValuesResponse.data || [];
      const orgFieldIds = new Set(orgFieldValues.map(fv => fv.field_id?.toString()));
      
      // Filter global fields to only include those that have values on organizations
      for (const field of allFields) {
        if (field && orgFieldIds.has(field.id?.toString())) {
          // This field has values on organizations, so it's an organization field
          organizationFields.push({
            id: field.id,
            name: field.name,
            value_type: field.value_type || 1,
            allows_multiple: field.allows_multiple || false,
            track_changes: field.track_changes || false
          });
          
          // Limit to 20 organization fields for performance
          if (organizationFields.length >= 20) break;
        }
      }
      
      console.log(`Found ${organizationFields.length} organization fields via API v1 global fields`);
      return organizationFields;
    } catch (error) {
      console.warn('Organization fields via API v1 not available:', error.message);
      return [];
    }
  }

  async getOpportunityFields(): Promise<AffinityField[]> {
    try {
      const response = await this.client.get('/v2/opportunities/fields');
      return response.data.data || response.data;
    } catch (error) {
      console.warn('Opportunity fields endpoint not available:', error);
      return [];
    }
  }

  // Helper method to map Affinity valueType to numeric value_type
  private mapValueType(valueType: string | number): number {
    if (typeof valueType === 'number') return valueType;
    
    const typeMap: { [key: string]: number } = {
      'text': 1,
      'number': 2,
      'datetime': 3,
      'dropdown': 4,
      'ranked-dropdown': 5,
      'dropdown-multi': 6,
      'person-multi': 7,
      'company-multi': 8,
      'interaction': 9
    };
    
    return typeMap[valueType] || 1;
  }

  // Helper method to infer value type from field value data
  private inferValueType(value: any): number {
    if (!value || !value.data) return 1; // Default to text
    
    if (value.data.type) return value.data.type;
    
    // Infer from the data structure
    if (typeof value.data === 'string') return 1; // Text
    if (typeof value.data === 'number') return 2; // Number
    if (Array.isArray(value.data)) return 6; // Multi-select
    if (value.data.text) return 1; // Text
    if (value.data.value) return 2; // Number
    
    return 1; // Default to text
  }

  async getListEntryFieldValues(listId: number, listEntryId: number): Promise<AffinityFieldValue[]> {
    const endpoint = `/v2/lists/${listId}/list-entries/${listEntryId}/fields`;
    const response = await this.client.get(endpoint);
    return response.data.data || response.data;
  }

  // Legacy v1 method - deprecated, use getListEntryFieldValues instead
  async getFieldValues(entityId: number, entityType: 'person' | 'organization' | 'opportunity'): Promise<AffinityFieldValue[]> {
    console.warn('getFieldValues is deprecated for v2 API. Use getListEntryFieldValues instead.');
    // For v2 API, this method cannot work the same way since field values are accessed through list entries
    // Return empty array to prevent crashes
    return [];
  }

  async getPerson(personId: number): Promise<AffinityPerson> {
    const response = await this.client.get(`/v2/persons/${personId}`);
    return response.data;
  }

  async getOrganization(organizationId: number): Promise<AffinityOrganization> {
    const response = await this.client.get(`/v2/organizations/${organizationId}`);
    return response.data;
  }

  // API v2 Field Update Status: Currently Not Available
  // Based on testing, Affinity API v2 does not yet support field value updates
  // The following endpoints return "No route matches" errors:
  // - PUT /v2/lists/{listId}/list-entries/{listEntryId}/field-values/{fieldId}
  // - PUT /v2/lists/{listId}/list-entries/{listEntryId}/actions
  
  async updateListEntryFields(listId: number, listEntryId: number, fieldUpdates: Array<{fieldId: string, value: any}>): Promise<any> {
    // SAFETY CHECK: This method only updates field values, never deletes entries
    console.log(`[AFFINITY API v2 LIMITATION] Field updates not yet supported in API v2`);
    console.log(`[AFFINITY SAFETY] Would update ${fieldUpdates.length} fields for list entry ${listEntryId} in list ${listId} - NO DELETION WILL OCCUR`);
    
    // Log what would be updated for transparency
    fieldUpdates.forEach(update => {
      console.log(`[AFFINITY PLANNED UPDATE] Field ${update.fieldId}: ${JSON.stringify(update.value)}`);
    });
    
    throw new Error(`Affinity API v2 field updates not yet available. Tested endpoints: /v2/lists/${listId}/list-entries/${listEntryId}/actions and field-values endpoints both return 404. Field update functionality requires API v1 or waiting for v2 field update support.`);
  }

  // Legacy method for backward compatibility (not supported in API v2)
  async updateFieldValue(fieldValueId: number, value: any): Promise<AffinityFieldValue> {
    console.log(`[AFFINITY API v2 LIMITATION] Individual field value updates not supported in API v2`);
    throw new Error(`Field value updates not available in Affinity API v2. Field ID: ${fieldValueId}, Value: ${JSON.stringify(value)}. API v2 currently supports data retrieval but not field modifications.`);
  }

  // SAFETY GUARANTEE: No deletion methods are implemented
  // This service will NEVER provide methods to delete Affinity entries
  private _deleteEntryNotAllowed(): never {
    throw new Error('SAFETY PROTECTION: Deleting Affinity entries is strictly forbidden');
  }

  async createListEntry(listId: number, entityId: number, entityType: number): Promise<AffinityListEntry> {
    const response = await this.client.post(`/v2/lists/${listId}/list-entries`, {
      entity_id: entityId,
      entity_type: entityType
    });
    return response.data;
  }

  async getRateLimit(): Promise<{ used: number, remaining: number, reset: number }> {
    try {
      const response = await this.client.get('/v2/rate-limit');
      return response.data;
    } catch (error) {
      // If rate limit endpoint doesn't exist, return mock data
      return { used: 0, remaining: 900, reset: 60 };
    }
  }

  // Helper method to determine entity type from entity object
  getEntityType(entity: any): 'person' | 'organization' | 'opportunity' {
    if (entity.first_name && entity.last_name) {
      return 'person';
    } else if (entity.domain || entity.domains) {
      return 'organization';
    } else {
      return 'opportunity';
    }
  }
}

export const affinityService = new AffinityService();

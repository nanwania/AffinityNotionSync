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

    console.log(`API v2 Request: GET /v2/lists/${listId}/list-entries with params:`, params);
    const response = await this.client.get(`/v2/lists/${listId}/list-entries`, { params });
    
    console.log(`API v2 Response: Got ${(response.data.data || []).length} entries`);
    console.log('Next URL:', response.data.nextUrl);
    
    // Debug: Log first entry structure to understand v2 response format
    if (response.data.data && response.data.data.length > 0) {
      console.log('First entry with fields:', JSON.stringify(response.data.data[0], null, 2).substring(0, 1000));
    }
    
    return {
      entries: response.data.data || [],
      nextUrl: response.data.nextUrl
    };
  }

  async getAllListEntries(listId: number): Promise<AffinityListEntry[]> {
    const allEntries: AffinityListEntry[] = [];
    let nextUrl: string | undefined;
    let pageCount = 0;

    console.log(`Fetching all entries for list ${listId} using API v2...`);

    do {
      pageCount++;
      
      let cursor: string | undefined;
      if (nextUrl) {
        // Extract cursor from nextUrl
        const url = new URL(nextUrl);
        cursor = url.searchParams.get('cursor') || undefined;
        console.log(`Fetching page ${pageCount} with cursor: ${cursor?.substring(0, 20)}...`);
      } else {
        console.log(`Fetching page ${pageCount} (first page)`);
      }
      
      const result = await this.getListEntries(listId, cursor);
      allEntries.push(...result.entries);
      nextUrl = result.nextUrl;
      
      console.log(`Page ${pageCount}: Got ${result.entries.length} entries. Total so far: ${allEntries.length}`);
      if (nextUrl) {
        console.log(`Next URL available: ${nextUrl.substring(0, 60)}...`);
      } else {
        console.log('No more pages available');
      }
    } while (nextUrl);

    console.log(`Finished fetching all entries. Total: ${allEntries.length} entries across ${pageCount} pages`);
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

  async updateFieldValue(fieldValueId: number, value: any): Promise<AffinityFieldValue> {
    const response = await this.client.put(`/v2/field-values/${fieldValueId}`, { value });
    return response.data;
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

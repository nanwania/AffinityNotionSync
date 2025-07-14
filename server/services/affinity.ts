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
      auth: {
        username: '',
        password: apiKey
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  async getLists(): Promise<AffinityList[]> {
    const response = await this.client.get('/lists');
    return response.data;
  }

  async getList(listId: number): Promise<AffinityList> {
    const response = await this.client.get(`/lists/${listId}`);
    return response.data;
  }

  async getListEntries(listId: number, pageSize: number = 100, pageToken?: string): Promise<{ entries: AffinityListEntry[], nextPageToken?: string }> {
    const params: any = { page_size: pageSize };
    if (pageToken) {
      params.page_token = pageToken;
    }

    const response = await this.client.get(`/lists/${listId}/list-entries`, { params });
    return {
      entries: response.data,
      nextPageToken: response.headers['x-next-page-token']
    };
  }

  async getAllListEntries(listId: number): Promise<AffinityListEntry[]> {
    const allEntries: AffinityListEntry[] = [];
    let nextPageToken: string | undefined;

    do {
      const result = await this.getListEntries(listId, 100, nextPageToken);
      allEntries.push(...result.entries);
      nextPageToken = result.nextPageToken;
    } while (nextPageToken);

    return allEntries;
  }

  async getFields(listId?: number): Promise<AffinityField[]> {
    const params = listId ? { list_id: listId } : {};
    const response = await this.client.get('/fields', { params });
    return response.data;
  }

  async getFieldValues(entityId: number, entityType: 'person' | 'organization' | 'opportunity'): Promise<AffinityFieldValue[]> {
    const params: any = {};
    if (entityType === 'person') {
      params.person_id = entityId;
    } else if (entityType === 'organization') {
      params.organization_id = entityId;
    } else if (entityType === 'opportunity') {
      params.opportunity_id = entityId;
    }

    const response = await this.client.get('/field-values', { params });
    return response.data;
  }

  async getPerson(personId: number): Promise<AffinityPerson> {
    const response = await this.client.get(`/persons/${personId}`);
    return response.data;
  }

  async getOrganization(organizationId: number): Promise<AffinityOrganization> {
    const response = await this.client.get(`/organizations/${organizationId}`);
    return response.data;
  }

  async updateFieldValue(fieldValueId: number, value: any): Promise<AffinityFieldValue> {
    const response = await this.client.put(`/field-values/${fieldValueId}`, { value });
    return response.data;
  }

  async createListEntry(listId: number, entityId: number, entityType: number): Promise<AffinityListEntry> {
    const response = await this.client.post(`/lists/${listId}/list-entries`, {
      entity_id: entityId,
      entity_type: entityType
    });
    return response.data;
  }

  async getRateLimit(): Promise<{ used: number, remaining: number, reset: number }> {
    try {
      const response = await this.client.get('/rate-limit');
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

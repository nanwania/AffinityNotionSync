import { Client } from "@notionhq/client";

export interface NotionDatabase {
  id: string;
  title: { type: string; text: { content: string } }[];
  properties: Record<string, any>;
  created_time: string;
  last_edited_time: string;
}

export interface NotionPage {
  id: string;
  properties: Record<string, any>;
  created_time: string;
  last_edited_time: string;
  parent: {
    type: string;
    database_id: string;
  };
}

export interface NotionProperty {
  id: string;
  name: string;
  type: string;
  [key: string]: any;
}

export const notion = new Client({
  auth: process.env.NOTION_INTEGRATION_SECRET!,
});

function extractPageIdFromUrl(pageUrl: string): string {
  const match = pageUrl.match(/([a-f0-9]{32})(?:[?#]|$)/i);
  if (match && match[1]) {
    return match[1];
  }
  throw Error("Failed to extract page ID");
}

export const NOTION_PAGE_ID = extractPageIdFromUrl(process.env.NOTION_PAGE_URL!);

export class NotionService {
  async getNotionDatabases(): Promise<NotionDatabase[]> {
    const allDatabases: NotionDatabase[] = [];

    try {
      // Get databases using the search API (which is working)
      let hasMore = true;
      let startCursor: string | undefined = undefined;

      while (hasMore) {
        const searchResponse = await notion.search({
          filter: {
            value: "database",
            property: "object"
          },
          start_cursor: startCursor,
        });

        for (const result of searchResponse.results) {
          if (result.object === "database") {
            allDatabases.push(result as NotionDatabase);
          }
        }

        hasMore = searchResponse.has_more;
        startCursor = searchResponse.next_cursor || undefined;
      }

      console.log(`Found ${allDatabases.length} databases`);
      return allDatabases;
    } catch (error: any) {
      console.error("Error listing databases:", error);
      console.error("Error details:", error.message);
      
      // Check if it's an authentication or permission error
      if (error.code === 'unauthorized' || error.status === 401) {
        console.error("Authentication failed - check NOTION_INTEGRATION_SECRET");
      } else if (error.code === 'restricted_resource' || error.status === 403) {
        console.error("Permission denied - integration may not have access to databases");
      }
      
      throw error;
    }
  }

  async findDatabaseByTitle(title: string): Promise<NotionDatabase | null> {
    const databases = await this.getNotionDatabases();

    for (const db of databases) {
      if (db.title && Array.isArray(db.title) && db.title.length > 0) {
        const dbTitle = db.title[0]?.text?.content?.toLowerCase() || "";
        if (dbTitle === title.toLowerCase()) {
          return db;
        }
      }
    }

    return null;
  }

  async createDatabaseIfNotExists(title: string, properties: Record<string, any>): Promise<NotionDatabase> {
    const existingDb = await this.findDatabaseByTitle(title);
    if (existingDb) {
      return existingDb;
    }

    const response = await notion.databases.create({
      parent: {
        type: "page_id",
        page_id: NOTION_PAGE_ID
      },
      title: [
        {
          type: "text",
          text: {
            content: title
          }
        }
      ],
      properties
    });

    return response as NotionDatabase;
  }

  async queryDatabase(databaseId: string, filter?: any, sorts?: any[]): Promise<NotionPage[]> {
    const allResults: NotionPage[] = [];
    let hasMore = true;
    let startCursor: string | undefined = undefined;

    while (hasMore) {
      const response = await notion.databases.query({
        database_id: databaseId,
        filter,
        sorts,
        start_cursor: startCursor,
      });

      allResults.push(...(response.results as NotionPage[]));
      hasMore = response.has_more;
      startCursor = response.next_cursor || undefined;
    }

    return allResults;
  }

  async getDatabase(databaseId: string): Promise<NotionDatabase> {
    const response = await notion.databases.retrieve({
      database_id: databaseId,
    });
    return response as NotionDatabase;
  }

  async getPage(pageId: string): Promise<NotionPage> {
    const response = await notion.pages.retrieve({
      page_id: pageId,
    });
    return response as NotionPage;
  }

  async createPage(databaseId: string, properties: Record<string, any>): Promise<NotionPage> {
    const response = await notion.pages.create({
      parent: {
        database_id: databaseId,
      },
      properties,
    });
    return response as NotionPage;
  }

  async updatePage(pageId: string, properties: Record<string, any>): Promise<NotionPage> {
    const response = await notion.pages.update({
      page_id: pageId,
      properties,
    });
    return response as NotionPage;
  }

  async deletePage(pageId: string): Promise<NotionPage> {
    const response = await notion.pages.update({
      page_id: pageId,
      archived: true,
    });
    return response as NotionPage;
  }

  async addPropertyToDatabase(databaseId: string, propertyName: string, propertyType: string = 'rich_text'): Promise<NotionDatabase> {
    // Map common property types to Notion schema
    const propertyTypeMap: Record<string, any> = {
      'text': { rich_text: {} },
      'rich_text': { rich_text: {} },
      'number': { number: {} },
      'select': { select: { options: [] } },
      'multi_select': { multi_select: { options: [] } },
      'date': { date: {} },
      'checkbox': { checkbox: {} },
      'url': { url: {} },
      'email': { email: {} },
      'phone_number': { phone_number: {} },
      'people': { people: {} },
      'relation': { relation: { database_id: '', single_property: '', dual_property: {} } },
      'formula': { formula: { expression: '' } },
      'rollup': { rollup: { relation_property_name: '', relation_property_id: '', rollup_property_name: '', rollup_property_id: '', function: 'count' } },
      'created_time': { created_time: {} },
      'created_by': { created_by: {} },
      'last_edited_time': { last_edited_time: {} },
      'last_edited_by': { last_edited_by: {} },
      'title': { title: {} }
    };

    const propertySchema = propertyTypeMap[propertyType] || { rich_text: {} };

    const response = await notion.databases.update({
      database_id: databaseId,
      properties: {
        [propertyName]: propertySchema
      }
    });

    return response as NotionDatabase;
  }

  // Helper methods to convert between Affinity and Notion data types
  convertAffinityToNotionProperty(affinityValue: any, notionPropertyType: string): any {
    switch (notionPropertyType) {
      case 'title':
        return {
          title: [{ type: 'text', text: { content: String(affinityValue || '') } }]
        };
      case 'rich_text':
        let textValue = affinityValue;
        
        // Handle organization arrays: [{"id":123,"name":"Company","domain":"example.com"}]
        if (Array.isArray(affinityValue) && affinityValue.length > 0) {
          if (affinityValue[0] && typeof affinityValue[0] === 'object' && affinityValue[0].name) {
            // Extract organization names
            textValue = affinityValue.map(org => org.name).join(', ');
          }
        }
        // Handle single organization object: {"id":123,"name":"Company","domain":"example.com"}
        else if (affinityValue && typeof affinityValue === 'object' && affinityValue.name) {
          textValue = affinityValue.name;
        }
        // Handle location objects or other complex objects
        else if (affinityValue && typeof affinityValue === 'object') {
          // If it's an object with a 'text' property, use that
          if (affinityValue.text) {
            textValue = affinityValue.text;
          }
          // If it's an object with a 'name' property, use that
          else if (affinityValue.name) {
            textValue = affinityValue.name;
          }
          // If it has an address-like structure (handle location objects from Affinity)
          else if (affinityValue.street_address !== undefined || affinityValue.city || affinityValue.state || affinityValue.country) {
            console.log(`[DEBUG] Converting location object to text: ${JSON.stringify(affinityValue)}`);
            const parts = [
              affinityValue.street_address,
              affinityValue.city,
              affinityValue.state,
              affinityValue.postal_code,
              affinityValue.country
            ].filter(Boolean);
            textValue = parts.join(', ');
            console.log(`[DEBUG] Location converted to: ${textValue}`);
          }
          // Otherwise try to JSON stringify it as a fallback
          else {
            try {
              textValue = JSON.stringify(affinityValue);
            } catch {
              textValue = String(affinityValue);
            }
          }
        }
        
        // Handle organization arrays with hyperlinks: [{"id":123,"name":"Company","domain":"example.com"}]
        if (Array.isArray(affinityValue) && affinityValue.length > 0) {
          const org = affinityValue[0];
          if (org && typeof org === 'object' && org.name && org.domain) {
            const url = org.domain.startsWith('http') ? org.domain : `https://${org.domain}`;
            return {
              rich_text: [{ 
                type: 'text', 
                text: { 
                  content: org.name,
                  link: { url: url }
                },
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: "default"
                }
              }]
            };
          }
        }
        // Handle single organization object with hyperlink: {"id":123,"name":"Company","domain":"example.com"}
        else if (affinityValue && typeof affinityValue === 'object' && affinityValue.name && affinityValue.domain) {
          const url = affinityValue.domain.startsWith('http') ? affinityValue.domain : `https://${affinityValue.domain}`;
          return {
            rich_text: [{ 
              type: 'text', 
              text: { 
                content: affinityValue.name,
                link: { url: url }
              },
              annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: "default"
              }
            }]
          };
        }
        
        return {
          rich_text: [{ type: 'text', text: { content: String(textValue || '') } }]
        };
      case 'number':
        if (affinityValue === null || affinityValue === undefined || affinityValue === '') {
          return { number: null };
        }
        const num = typeof affinityValue === 'string' ? parseInt(affinityValue, 10) : Number(affinityValue);
        return {
          number: isNaN(num) ? null : num
        };
      case 'select':
        let selectValue = affinityValue;
        // Handle Affinity dropdown format: { dropdownOptionId: X, text: "Option Text" }
        if (typeof affinityValue === 'object' && affinityValue.text) {
          selectValue = affinityValue.text;
        } else if (Array.isArray(affinityValue) && affinityValue.length > 0 && affinityValue[0].text) {
          selectValue = affinityValue[0].text; // Take first option for single select
        }
        return {
          select: selectValue ? { name: String(selectValue) } : null
        };
      case 'multi_select':
        let values = Array.isArray(affinityValue) ? affinityValue : [affinityValue];
        // Handle Affinity dropdown format: [{ dropdownOptionId: X, text: "Option Text" }]
        values = values.filter(v => v).map(v => {
          if (typeof v === 'object' && v.text) {
            return v.text; // Extract text from dropdown object
          }
          return String(v);
        });
        return {
          multi_select: values.map(v => ({ name: v }))
        };
      case 'date':
        return {
          date: affinityValue ? { start: affinityValue } : null
        };
      case 'checkbox':
        return {
          checkbox: Boolean(affinityValue)
        };
      case 'email':
        return {
          email: String(affinityValue || '')
        };
      case 'phone_number':
        return {
          phone_number: String(affinityValue || '')
        };
      case 'url':
        let urlValue = affinityValue;
        
        // Handle organization arrays: [{"id":123,"name":"Company","domain":"example.com"}]
        if (Array.isArray(affinityValue) && affinityValue.length > 0) {
          if (affinityValue[0] && typeof affinityValue[0] === 'object' && affinityValue[0].domain) {
            // Use the domain from the first organization
            urlValue = affinityValue[0].domain.startsWith('http') 
              ? affinityValue[0].domain 
              : `https://${affinityValue[0].domain}`;
          } else {
            urlValue = null;
          }
        }
        // Handle single organization object: {"id":123,"name":"Company","domain":"example.com"}
        else if (affinityValue && typeof affinityValue === 'object' && affinityValue.domain) {
          urlValue = affinityValue.domain.startsWith('http') 
            ? affinityValue.domain 
            : `https://${affinityValue.domain}`;
        }
        // Handle direct URL strings
        else if (typeof affinityValue === 'string' && affinityValue) {
          urlValue = affinityValue.startsWith('http') ? affinityValue : `https://${affinityValue}`;
        }
        else {
          urlValue = null;
        }
        
        return {
          url: urlValue
        };
      default:
        return {
          rich_text: [{ type: 'text', text: { content: String(affinityValue || '') } }]
        };
    }
  }

  convertNotionToAffinityValue(notionProperty: any): any {
    if (!notionProperty) return null;

    switch (notionProperty.type) {
      case 'title':
        return notionProperty.title?.[0]?.text?.content || '';
      case 'rich_text':
        return notionProperty.rich_text?.[0]?.text?.content || '';
      case 'number':
        return notionProperty.number;
      case 'select':
        return notionProperty.select?.name || null;
      case 'multi_select':
        return notionProperty.multi_select?.map((s: any) => s.name) || [];
      case 'date':
        return notionProperty.date?.start || null;
      case 'checkbox':
        return notionProperty.checkbox || false;
      case 'email':
        return notionProperty.email || '';
      case 'phone_number':
        return notionProperty.phone_number || '';
      case 'url':
        return notionProperty.url || '';
      default:
        return notionProperty.rich_text?.[0]?.text?.content || '';
    }
  }

  getDatabaseTitle(database: NotionDatabase): string {
    if (database.title && Array.isArray(database.title) && database.title.length > 0) {
      return database.title[0]?.text?.content || '';
    }
    return '';
  }

  getPropertyType(database: NotionDatabase, propertyName: string): string {
    return database.properties[propertyName]?.type || 'rich_text';
  }
}

export const notionService = new NotionService();

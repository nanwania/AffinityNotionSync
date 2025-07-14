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
    const childDatabases: NotionDatabase[] = [];

    try {
      let hasMore = true;
      let startCursor: string | undefined = undefined;

      while (hasMore) {
        const response = await notion.blocks.children.list({
          block_id: NOTION_PAGE_ID,
          start_cursor: startCursor,
        });

        for (const block of response.results) {
          if (block.type === "child_database") {
            const databaseId = block.id;

            try {
              const databaseInfo = await notion.databases.retrieve({
                database_id: databaseId,
              });

              childDatabases.push(databaseInfo as NotionDatabase);
            } catch (error) {
              console.error(`Error retrieving database ${databaseId}:`, error);
            }
          }
        }

        hasMore = response.has_more;
        startCursor = response.next_cursor || undefined;
      }

      return childDatabases;
    } catch (error) {
      console.error("Error listing child databases:", error);
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

  // Helper methods to convert between Affinity and Notion data types
  convertAffinityToNotionProperty(affinityValue: any, notionPropertyType: string): any {
    switch (notionPropertyType) {
      case 'title':
        return {
          title: [{ type: 'text', text: { content: String(affinityValue || '') } }]
        };
      case 'rich_text':
        return {
          rich_text: [{ type: 'text', text: { content: String(affinityValue || '') } }]
        };
      case 'number':
        return {
          number: Number(affinityValue) || null
        };
      case 'select':
        return {
          select: affinityValue ? { name: String(affinityValue) } : null
        };
      case 'multi_select':
        const values = Array.isArray(affinityValue) ? affinityValue : [affinityValue];
        return {
          multi_select: values.filter(v => v).map(v => ({ name: String(v) }))
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
        return {
          url: String(affinityValue || '')
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

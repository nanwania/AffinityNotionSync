// Test script to troubleshoot Notion integration
import { Client } from '@notionhq/client';

const notion = new Client({
  auth: process.env.NOTION_INTEGRATION_SECRET
});

async function testNotionIntegration() {
  console.log('Testing Notion integration...');
  console.log('Secret exists:', !!process.env.NOTION_INTEGRATION_SECRET);
  console.log('Page URL:', process.env.NOTION_PAGE_URL);
  
  try {
    // Test basic authentication
    console.log('\n1. Testing search API...');
    const searchResponse = await notion.search({
      filter: {
        value: "database",
        property: "object"
      }
    });
    console.log('Search response:', JSON.stringify(searchResponse, null, 2));
    
    // Test page access
    console.log('\n2. Testing page access...');
    const pageId = process.env.NOTION_PAGE_URL.match(/([a-f0-9]{32})(?:[?#]|$)/i)?.[1];
    if (pageId) {
      const pageResponse = await notion.blocks.children.list({
        block_id: pageId,
      });
      console.log('Page blocks:', JSON.stringify(pageResponse, null, 2));
    }
    
    // Test creating a database
    console.log('\n3. Testing database creation...');
    const createResponse = await notion.databases.create({
      parent: {
        type: "page_id",
        page_id: pageId
      },
      title: [
        {
          type: "text",
          text: {
            content: "Test Database"
          }
        }
      ],
      properties: {
        Name: {
          title: {}
        },
        Status: {
          select: {
            options: [
              { name: "Active", color: "green" },
              { name: "Inactive", color: "red" }
            ]
          }
        }
      }
    });
    console.log('Created database:', JSON.stringify(createResponse, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Code:', error.code);
    console.error('Status:', error.status);
  }
}

testNotionIntegration();
import axios from 'axios';

async function checkNotionPages() {
  try {
    // Query all pages to see what's there
    const response = await axios.post('http://localhost:5000/api/notion/databases/22997a76-0b2c-80e6-b302-c3a2e8f66d06/query', {});
    
    const data = response.data;
    const pages = Array.isArray(data) ? data : data.results || [];
    
    console.log(`Found ${pages.length} total pages in Notion database:`);
    
    // Check first 10 pages
    pages.slice(0, 10).forEach((page, index) => {
      console.log(`\nPage ${index + 1}:`);
      console.log(`  Affinity_ID: ${page.properties.Affinity_ID?.number || 'N/A'}`);
      console.log(`  Name: ${page.properties.Name?.title?.[0]?.text?.content || 'N/A'}`);
      console.log(`  Organization: ${page.properties.Organization?.rich_text?.[0]?.text?.content || 'N/A'}`);
      console.log(`  Location: ${page.properties.Location?.rich_text?.[0]?.text?.content || 'EMPTY'}`);
      console.log(`  Expected Ahren Investment: ${page.properties['Expected Ahren Investment']?.number || 'N/A'}`);
      console.log(`  Upcoming Round: ${page.properties['Upcoming Round']?.multi_select?.map(item => item.name).join(', ') || 'N/A'}`);
      console.log(`  Organization_ID: ${page.properties.Organization_ID?.number || 'N/A'}`);
      console.log(`  Last Modified: ${page.last_edited_time}`);
      
      // Debug: show full properties if needed
      if (page.properties.Location?.rich_text?.length === 0) {
        console.log(`  Location (full): ${JSON.stringify(page.properties.Location)}`);
      }
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkNotionPages();
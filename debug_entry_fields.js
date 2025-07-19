import axios from 'axios';

async function checkEntryFields() {
  try {
    console.log('=== Checking Entry Fields for Description ===');
    
    // Get the Klura entry (98799987) to see its field structure
    const response = await axios.get('https://api.affinity.co/v2/list-entries/98799987', {
      headers: {
        'Authorization': `Bearer ${process.env.AFFINITY_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    const entry = response.data.data;
    console.log(`Entry: ${entry.entity?.name || 'Unknown'}`);
    console.log(`Fields found: ${entry.entity?.fields?.length || 0}`);
    
    if (entry.entity?.fields) {
      console.log('\n=== All Fields in Entry ===');
      entry.entity.fields.forEach((field, index) => {
        const value = field.value?.data;
        const valuePreview = typeof value === 'string' ? 
          value.substring(0, 100) + (value.length > 100 ? '...' : '') :
          JSON.stringify(value);
        
        console.log(`${index + 1}. Field ID: ${field.id}`);
        console.log(`   Value: ${valuePreview}`);
        console.log(`   Type: ${typeof value}`);
        console.log('---');
      });
    }
    
    // Also check for global fields that might contain descriptions
    console.log('\n=== Checking for Global Description Fields ===');
    const globalResponse = await axios.get('https://api.affinity.co/v2/field-types', {
      headers: {
        'Authorization': `Bearer ${process.env.AFFINITY_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (globalResponse.data?.data) {
      const descFields = globalResponse.data.data.filter(field => 
        field.name.toLowerCase().includes('description') ||
        field.name.toLowerCase() === 'description'
      );
      
      console.log(`Found ${descFields.length} description-related global fields:`);
      descFields.forEach(field => {
        console.log(`- ${field.name} (${field.id}) - Entity: ${field.entityType}`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

checkEntryFields();
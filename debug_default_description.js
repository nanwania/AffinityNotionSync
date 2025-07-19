import axios from 'axios';

async function findDefaultDescriptionField() {
  try {
    console.log('=== Finding Default Description Field ===');
    
    // Get all field types from Affinity API v2
    const response = await axios.get('https://api.affinity.co/v2/field-types', {
      headers: {
        'Authorization': `Bearer ${process.env.AFFINITY_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    const fieldTypes = response.data.data;
    console.log(`Found ${fieldTypes.length} total field types`);
    
    // Look for description-related fields
    console.log('\n=== Description-related fields ===');
    const descriptionFields = fieldTypes.filter(field => 
      field.name.toLowerCase().includes('description') || 
      field.name.toLowerCase().includes('desc') ||
      field.name === 'Description' // Exact match for default
    );
    
    descriptionFields.forEach(field => {
      console.log(`Field: ${field.name}`);
      console.log(`  ID: ${field.id}`);
      console.log(`  Type: ${field.valueType}`);
      console.log(`  Entity: ${field.entityType}`);
      console.log('---');
    });
    
    // Look for the exact "Description" field (default)
    const defaultDesc = fieldTypes.find(field => field.name === 'Description');
    if (defaultDesc) {
      console.log('\n=== FOUND DEFAULT DESCRIPTION FIELD ===');
      console.log(`Name: ${defaultDesc.name}`);
      console.log(`ID: ${defaultDesc.id}`);
      console.log(`Type: ${defaultDesc.valueType}`);
      console.log(`Entity: ${defaultDesc.entityType}`);
    } else {
      console.log('\n=== No exact "Description" field found ===');
      
      // Look for any field that might be the default description
      console.log('\nAll fields with "description" in name:');
      fieldTypes.filter(f => f.name.toLowerCase().includes('description')).forEach(field => {
        console.log(`- ${field.name} (${field.id}) - ${field.entityType}`);
      });
    }
    
  } catch (error) {
    console.error('Error finding description field:', error.response?.data || error.message);
  }
}

findDefaultDescriptionField();
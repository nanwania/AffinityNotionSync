import axios from 'axios';

async function checkOrgFields() {
  try {
    const response = await axios.get('http://localhost:5000/api/affinity/lists/304126/all-fields');
    const fields = response.data;
    
    console.log('=== ORGANIZATION FIELDS ===');
    fields.organization.forEach(field => {
      if (field.name.toLowerCase().includes('location') || 
          field.name.toLowerCase().includes('address') ||
          field.name.toLowerCase().includes('headquarter') ||
          field.name.toLowerCase().includes('office')) {
        console.log(`- ${field.name} (ID: ${field.id})`);
      }
    });
    
    console.log('\n=== ALL ORGANIZATION FIELDS ===');
    fields.organization.forEach(field => {
      console.log(`- ${field.name} (ID: ${field.id})`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkOrgFields();
import { affinityService } from './server/services/affinity.js';

async function findDefaultDescription() {
  try {
    console.log('=== Finding Default Description Field ===');
    
    // Get a sample of entries to analyze their field structure
    const entries = await affinityService.getListEntries(304126);
    console.log(`Got ${entries.entries?.length || 0} entries to analyze`);
    
    if (!entries.entries || entries.entries.length === 0) {
      console.log('No entries found');
      return;
    }
    
    // Look at first few entries to understand field structure
    const sampleEntries = entries.entries.slice(0, 5);
    const allFieldIds = new Set();
    const fieldInfoMap = new Map();
    
    for (const entry of sampleEntries) {
      console.log(`\n--- Entry ${entry.id} (${entry.entity?.name || 'Unknown'}) ---`);
      
      if (entry.entity?.fields && Array.isArray(entry.entity.fields)) {
        for (const field of entry.entity.fields) {
          allFieldIds.add(field.id);
          
          if (!fieldInfoMap.has(field.id)) {
            fieldInfoMap.set(field.id, {
              id: field.id,
              samples: [],
              valueTypes: new Set()
            });
          }
          
          const fieldInfo = fieldInfoMap.get(field.id);
          if (field.value?.data !== null && field.value?.data !== undefined) {
            const valueStr = typeof field.value.data === 'string' ? 
              field.value.data.substring(0, 100) : 
              JSON.stringify(field.value.data).substring(0, 100);
            fieldInfo.samples.push(`${entry.entity?.name}: ${valueStr}`);
            fieldInfo.valueTypes.add(typeof field.value.data);
          }
        }
      }
    }
    
    console.log(`\n=== Found ${allFieldIds.size} unique field IDs ===`);
    
    // Look for text fields that might be descriptions
    for (const fieldId of allFieldIds) {
      const fieldInfo = fieldInfoMap.get(fieldId);
      const textSamples = fieldInfo.samples.filter(s => 
        s.length > 50 && // Longer text
        !s.includes('field-') && // Not a field reference
        !s.includes('@') && // Not an email
        !s.includes('http') // Not a URL
      );
      
      if (textSamples.length > 0) {
        console.log(`\nField ${fieldId} - Potential Description Field:`);
        textSamples.forEach(sample => console.log(`  ${sample}`));
      }
    }
    
    // Check specific field IDs we know about
    console.log('\n=== Checking Known Description Fields ===');
    const knownDescFields = [
      'field-5190739', // Ahren Description
      'field-5190718', // EMAIL Weekly Comment
      'field-5241677'  // Additional Round Details
    ];
    
    for (const fieldId of knownDescFields) {
      if (fieldInfoMap.has(fieldId)) {
        const fieldInfo = fieldInfoMap.get(fieldId);
        console.log(`\n${fieldId}:`);
        fieldInfo.samples.forEach(sample => console.log(`  ${sample}`));
      } else {
        console.log(`\n${fieldId}: Not found in sample data`);
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

findDefaultDescription();
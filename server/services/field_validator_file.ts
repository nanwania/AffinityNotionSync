// server/utils/field-validator.ts
import type { AffinityField, NotionProperty, FieldMapping } from "@shared/types";

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Phone number regex (supports various formats)
const PHONE_REGEX = /^[\+]?[1-9]?[\d\s\-\(\)\.]{10,}$/;

// URL validation regex
const URL_REGEX = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/;

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  warnings: ValidationWarning[];
  suggestions?: string[];
}

export interface ValidationIssue {
  type: 'type_mismatch' | 'format_invalid' | 'required_missing' | 'value_too_long';
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationWarning {
  type: 'data_loss' | 'format_change' | 'compatibility';
  field: string;
  message: string;
  suggestion?: string;
}

export class FieldValidator {
  /**
   * Validates field mapping compatibility between Affinity and Notion
   */
  static validateMapping(
    affinityField: AffinityField, 
    notionPropertyType: string,
    notionProperty?: NotionProperty
  ): ValidationResult {
    const issues: ValidationIssue[] = [];
    const warnings: ValidationWarning[] = [];
    const suggestions: string[] = [];

    // Check basic type compatibility
    const compatibility = this.checkTypeCompatibility(affinityField.type, notionPropertyType);
    
    if (!compatibility.compatible) {
      issues.push({
        type: 'type_mismatch',
        field: affinityField.name,
        message: `Affinity field type '${affinityField.type}' cannot be mapped to Notion property type '${notionPropertyType}'`,
        severity: 'error'
      });
      
      if (compatibility.suggestedTypes.length > 0) {
        suggestions.push(`Consider using one of these Notion property types: ${compatibility.suggestedTypes.join(', ')}`);
      }
    } else if (compatibility.dataLoss) {
      warnings.push({
        type: 'data_loss',
        field: affinityField.name,
        message: compatibility.warningMessage || 'Some data formatting may be lost in this mapping',
        suggestion: compatibility.suggestion
      });
    }

    // Check for dropdown/select option compatibility
    if (affinityField.type === 'dropdown' && (notionPropertyType === 'select' || notionPropertyType === 'multi_select')) {
      this.validateDropdownOptions(affinityField, notionProperty, warnings);
    }

    // Check field name compatibility
    if (affinityField.name.length > 100) {
      warnings.push({
        type: 'format_change',
        field: affinityField.name,
        message: 'Field name is very long and may be truncated in Notion',
        suggestion: 'Consider using a shorter property name in Notion'
      });
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings,
      suggestions: suggestions.length > 0 ? suggestions : undefined
    };
  }

  /**
   * Sanitizes and validates field values based on their target type
   */
  static sanitizeFieldValue(value: any, targetType: string, options?: { strict?: boolean }): {
    sanitizedValue: any;
    isValid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];
    let sanitizedValue = value;
    let isValid = true;

    if (value === null || value === undefined || value === '') {
      return { sanitizedValue: null, isValid: true, issues: [] };
    }

    switch (targetType) {
      case 'email':
        sanitizedValue = String(value).trim().toLowerCase();
        if (!EMAIL_REGEX.test(sanitizedValue)) {
          if (options?.strict) {
            isValid = false;
            sanitizedValue = null;
          }
          issues.push(`Invalid email format: ${value}`);
        }
        break;

      case 'phone_number':
        // Clean phone number - remove extra spaces and formatting
        sanitizedValue = String(value).replace(/[^\d\+\-\(\)\.]/g, '');
        if (!PHONE_REGEX.test(sanitizedValue)) {
          if (options?.strict) {
            isValid = false;
            sanitizedValue = null;
          } else {
            // Try to salvage what we can
            const digitsOnly = sanitizedValue.replace(/[^\d]/g, '');
            if (digitsOnly.length >= 10) {
              sanitizedValue = digitsOnly;
            } else {
              sanitizedValue = null;
              issues.push(`Invalid phone number format: ${value}`);
            }
          }
        }
        break;

      case 'url':
        try {
          // Try to parse as-is first
          if (typeof value === 'string' && URL_REGEX.test(value)) {
            sanitizedValue = value;
          } else {
            // Try adding https:// prefix
            const withProtocol = `https://${String(value)}`;
            if (URL_REGEX.test(withProtocol)) {
              sanitizedValue = withProtocol;
            } else {
              throw new Error('Invalid URL');
            }
          }
        } catch {
          if (options?.strict) {
            isValid = false;
            sanitizedValue = null;
          }
          issues.push(`Invalid URL format: ${value}`);
        }
        break;

      case 'number':
        const num = parseFloat(String(value).replace(/[^\d\.-]/g, ''));
        if (isNaN(num)) {
          if (options?.strict) {
            isValid = false;
            sanitizedValue = null;
          }
          issues.push(`Invalid number format: ${value}`);
        } else {
          sanitizedValue = num;
        }
        break;

      case 'date':
        try {
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            throw new Error('Invalid date');
          }
          sanitizedValue = date.toISOString().split('T')[0]; // YYYY-MM-DD format
        } catch {
          if (options?.strict) {
            isValid = false;
            sanitizedValue = null;
          }
          issues.push(`Invalid date format: ${value}`);
        }
        break;

      case 'checkbox':
        // Convert various truthy/falsy values to boolean
        if (typeof value === 'boolean') {
          sanitizedValue = value;
        } else if (typeof value === 'string') {
          const lowered = value.toLowerCase().trim();
          sanitizedValue = ['true', 'yes', '1', 'on', 'checked'].includes(lowered);
        } else if (typeof value === 'number') {
          sanitizedValue = value !== 0;
        } else {
          sanitizedValue = Boolean(value);
        }
        break;

      case 'rich_text':
      case 'title':
        sanitizedValue = String(value).trim();
        if (sanitizedValue.length > 2000) {
          sanitizedValue = sanitizedValue.substring(0, 2000) + '...';
          issues.push(`Text was truncated to 2000 characters`);
        }
        break;

      case 'select':
      case 'multi_select':
        // Handle dropdown objects from Affinity
        if (Array.isArray(value)) {
          sanitizedValue = value
            .map(v => typeof v === 'object' && v.text ? v.text : String(v))
            .filter(Boolean);
        } else if (typeof value === 'object' && value.text) {
          sanitizedValue = [value.text];
        } else {
          sanitizedValue = [String(value)];
        }
        break;

      default:
        sanitizedValue = String(value);
    }

    return { sanitizedValue, isValid, issues };
  }

  /**
   * Suggests optimal Notion property types for Affinity fields
   */
  static suggestNotionPropertyType(affinityField: AffinityField): {
    recommended: string;
    alternatives: string[];
    reason: string;
  } {
    const typeMap: Record<string, { recommended: string; alternatives: string[]; reason: string }> = {
      'text': {
        recommended: 'rich_text',
        alternatives: ['title'],
        reason: 'Rich text supports formatting and is most flexible for text content'
      },
      'dropdown': {
        recommended: 'select',
        alternatives: ['multi_select', 'rich_text'],
        reason: 'Select maintains dropdown options and ensures data consistency'
      },
      'multi_dropdown': {
        recommended: 'multi_select',
        alternatives: ['rich_text'],
        reason: 'Multi-select preserves multiple selection capability'
      },
      'number': {
        recommended: 'number',
        alternatives: ['rich_text'],
        reason: 'Number type enables mathematical operations and proper sorting'
      },
      'date': {
        recommended: 'date',
        alternatives: ['rich_text'],
        reason: 'Date type provides calendar integration and date-specific features'
      },
      'email': {
        recommended: 'email',
        alternatives: ['rich_text', 'url'],
        reason: 'Email type provides validation and mailto link functionality'
      },
      'url': {
        recommended: 'url',
        alternatives: ['rich_text'],
        reason: 'URL type provides link validation and clickable links'
      },
      'boolean': {
        recommended: 'checkbox',
        alternatives: ['select'],
        reason: 'Checkbox provides true/false toggle functionality'
      }
    };

    return typeMap[affinityField.type] || {
      recommended: 'rich_text',
      alternatives: [],
      reason: 'Rich text is the most flexible option for unknown field types'
    };
  }

  private static checkTypeCompatibility(affinityType: string, notionType: string): {
    compatible: boolean;
    dataLoss?: boolean;
    warningMessage?: string;
    suggestion?: string;
    suggestedTypes: string[];
  } {
    const compatibilityMatrix: Record<string, Record<string, any>> = {
      'text': {
        'rich_text': { compatible: true },
        'title': { compatible: true },
        'select': { compatible: true, dataLoss: true, warningMessage: 'Text will be treated as a single select option' },
        'email': { compatible: true, dataLoss: true, warningMessage: 'Only valid emails will be preserved' },
        'url': { compatible: true, dataLoss: true, warningMessage: 'Only valid URLs will be preserved' },
        'number': { compatible: false, suggestedTypes: ['rich_text'] },
        'date': { compatible: false, suggestedTypes: ['rich_text'] }
      },
      'dropdown': {
        'select': { compatible: true },
        'multi_select': { compatible: true, warningMessage: 'Single selections will be converted to arrays' },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'Dropdown structure will be lost' },
        'number': { compatible: false, suggestedTypes: ['select', 'rich_text'] },
        'date': { compatible: false, suggestedTypes: ['select', 'rich_text'] }
      },
      'multi_dropdown': {
        'multi_select': { compatible: true },
        'select': { compatible: true, dataLoss: true, warningMessage: 'Only first selection will be preserved' },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'Multiple selections will be joined as text' }
      },
      'number': {
        'number': { compatible: true },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'Number formatting and calculations will be lost' },
        'select': { compatible: false, suggestedTypes: ['number', 'rich_text'] }
      },
      'date': {
        'date': { compatible: true },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'Date functionality will be lost' }
      },
      'boolean': {
        'checkbox': { compatible: true },
        'select': { compatible: true, warningMessage: 'Boolean values will become select options' },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'True/false functionality will be lost' }
      },
      'email': {
        'email': { compatible: true },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'Email validation and mailto links will be lost' },
        'url': { compatible: true, dataLoss: true, warningMessage: 'Email will be treated as URL' }
      },
      'url': {
        'url': { compatible: true },
        'rich_text': { compatible: true, dataLoss: true, warningMessage: 'Clickable links will be lost' }
      }
    };

    const compatibility = compatibilityMatrix[affinityType]?.[notionType];
    
    if (!compatibility) {
      return {
        compatible: false,
        suggestedTypes: ['rich_text'] // Default fallback
      };
    }

    return {
      compatible: compatibility.compatible,
      dataLoss: compatibility.dataLoss,
      warningMessage: compatibility.warningMessage,
      suggestion: compatibility.suggestion,
      suggestedTypes: compatibility.suggestedTypes || []
    };
  }

  private static validateDropdownOptions(
    affinityField: AffinityField,
    notionProperty: NotionProperty | undefined,
    warnings: ValidationWarning[]
  ) {
    if (!affinityField.options || !notionProperty) return;

    const affinityOptions = affinityField.options.map(opt => opt.text || opt.name);
    const notionOptions = notionProperty.type === 'select' 
      ? notionProperty.select?.options?.map(opt => opt.name) || []
      : notionProperty.multi_select?.options?.map(opt => opt.name) || [];

    const missingOptions = affinityOptions.filter(opt => !notionOptions.includes(opt));
    
    if (missingOptions.length > 0) {
      warnings.push({
        type: 'compatibility',
        field: affinityField.name,
        message: `Some Affinity dropdown options are missing in Notion: ${missingOptions.join(', ')}`,
        suggestion: 'Consider adding these options to the Notion property or they will be created automatically'
      });
    }
  }
}
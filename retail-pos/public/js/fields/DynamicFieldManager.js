/**
 * js/fields/DynamicFieldManager.js
 * Renders dynamic forms and maps custom attributes to products
 */

export class DynamicFieldManager {
  constructor(firestoreDb) {
    this.db = firestoreDb;
    this.fields = [];
  }

  async loadFields() {
    const snap = await this.db.collection('customFields')
      .where('active', '==', true)
      .orderBy('sortOrder', 'asc')
      .get();
    this.fields = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return this.fields;
  }

  renderFormElements(containerElement, context = 'POS', initialData = {}) {
    containerElement.innerHTML = '';
    
    this.fields.forEach(field => {
      if (context === 'POS' && !field.visibleInPos) return;
      if (context === 'INVENTORY' && !field.visibleInInventory) return;

      const group = document.createElement('div');
      group.className = 'form-group dynamic-field-group';
      group.dataset.fieldId = field.fieldId;

      const label = document.createElement('label');
      label.textContent = field.label + (field.required ? ' *' : '');
      group.appendChild(label);

      let input;
      const currentValue = initialData[field.name] !== undefined ? initialData[field.name] : (field.defaultValue || '');

      switch (field.type) {
        case 'dropdown':
          input = document.createElement('select');
          input.name = field.name;
          (field.options || []).forEach(opt => {
            const optEl = document.createElement('option');
            optEl.value = opt;
            optEl.textContent = opt;
            if (opt === currentValue) optEl.selected = true;
            input.appendChild(optEl);
          });
          break;

        case 'boolean':
          input = document.createElement('input');
          input.type = 'checkbox';
          input.name = field.name;
          input.checked = Boolean(currentValue);
          break;

        case 'number':
        case 'currency':
        case 'percentage':
          input = document.createElement('input');
          input.type = 'number';
          input.step = field.type === 'currency' ? '0.01' : '1';
          input.name = field.name;
          input.value = currentValue;
          break;

        case 'date':
          input = document.createElement('input');
          input.type = 'date';
          input.name = field.name;
          input.value = currentValue;
          break;

        default: // text, url, image url
          input = document.createElement('input');
          input.type = 'text';
          input.name = field.name;
          input.value = currentValue;
      }

      input.className = 'form-control dynamic-input';
      if (field.required) input.required = true;
      group.appendChild(input);
      containerElement.appendChild(group);
    });
  }

  extractValues(containerElement) {
    const dynamicValues = {};
    const inputs = containerElement.querySelectorAll('.dynamic-input');
    inputs.forEach(input => {
      const field = this.fields.find(f => f.name === input.name);
      if (!field) return;

      if (field.type === 'boolean') {
        dynamicValues[field.name] = input.checked;
      } else if (['number', 'currency', 'percentage'].includes(field.type)) {
        dynamicValues[field.name] = input.value === '' ? null : Number(input.value);
      } else {
        dynamicValues[field.name] = input.value.trim();
      }
    });
    return dynamicValues;
  }
}

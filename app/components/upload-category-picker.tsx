'use client';

import { useMemo } from 'react';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@/components/ui/combobox';
import { categoryPath, type CategoryNode } from '@/lib/category-path';

/** Search complete paths while keeping category IDs, rather than ambiguous names, as the saved destination. */
export function UploadCategoryPicker({
  categories,
  value,
  onChange,
  disabled,
}: {
  categories: CategoryNode[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const choices = useMemo(
    () =>
      categories
        .map((category) => ({
          value: category.id,
          label: categoryPath(category.id, categories),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [categories],
  );
  return (
    <div className="upload-category-picker">
      <label htmlFor="upload-category">Category</label>
      <Combobox
        items={choices}
        value={choices.find((choice) => choice.value === value) ?? null}
        onValueChange={(choice) => onChange(choice?.value ?? '')}
        disabled={disabled}
      >
        <ComboboxInput
          id="upload-category"
          aria-label="Delivery category"
          aria-describedby="upload-category-destination"
          placeholder="Search categories or parent names…"
          disabled={disabled}
          showClear
        />
        <ComboboxContent className="upload-category-options">
          <ComboboxEmpty>No matching categories</ComboboxEmpty>
          <ComboboxList>
            {(choice: { value: string; label: string }) => (
              <ComboboxItem key={choice.value} value={choice} className="upload-category-option">
                {choice.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <p id="upload-category-destination" className="upload-category-destination" role="status">
        {value ? (
          <>
            Photos will be added to <strong>{categoryPath(value, categories)}</strong>
          </>
        ) : (
          'Choose a category before adding photos to Receiving.'
        )}
      </p>
    </div>
  );
}

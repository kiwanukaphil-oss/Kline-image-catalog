'use client';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PriceExceptionRule } from '@/lib/pricing-groups';

export type PricingChoice = { value: string; label: string };

/** Use the shared accessible picker for exact category, brand and size choices. */
export function PricingChoiceField({
  label,
  value,
  choices,
  allLabel,
  caption,
  onChange,
}: {
  label: string;
  value: string;
  choices: PricingChoice[];
  allLabel: string;
  caption?: string;
  onChange: (value: string) => void;
}) {
  const options = [{ value: '', label: allLabel }, ...choices];
  return (
    <div className="pricing-choice">
      <span>{caption || label}</span>
      <Select value={value} onValueChange={(next) => onChange(next || '')} items={options}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Reveal exception controls only when requested; optional brand and size conditions are combined. */
export function PricingExceptionRules({
  rules,
  brands,
  sizes,
  counts,
  onChange,
}: {
  rules: PriceExceptionRule[];
  brands: PricingChoice[];
  sizes: PricingChoice[];
  counts: Record<string, number>;
  onChange: (rules: PriceExceptionRule[]) => void;
}) {
  const updateRule = (id: string, patch: Partial<PriceExceptionRule>) =>
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  return (
    <div className="pricing-exceptions">
      {rules.map((rule, index) => (
        <fieldset className="pricing-exception" key={rule.id}>
          <legend>Exception {index + 1}</legend>
          <Button
            variant="ghost"
            size="icon"
            className="remove-exception"
            aria-label={`Remove exception ${index + 1}`}
            onClick={() => onChange(rules.filter((entry) => entry.id !== rule.id))}
          >
            <X size={16} />
          </Button>
          <PricingChoiceField
            label={`Brand for exception ${index + 1}`}
            caption="Brand"
            value={rule.brand}
            choices={brands}
            allLabel="Any brand"
            onChange={(brand) => updateRule(rule.id, { brand })}
          />
          <PricingChoiceField
            label={`Size for exception ${index + 1}`}
            caption="Size"
            value={rule.size}
            choices={sizes}
            allLabel="Any size"
            onChange={(size) => updateRule(rule.id, { size })}
          />
          <label>
            Price / UGX
            <Input
              aria-label={`Price for exception ${index + 1}`}
              inputMode="decimal"
              value={rule.price}
              placeholder="0"
              onChange={(event) => updateRule(rule.id, { price: event.target.value })}
            />
          </label>
          <small>{counts[rule.id] || 0} selected sizes match</small>
        </fieldset>
      ))}
      <Button
        variant="outline"
        onClick={() => onChange([...rules, { id: crypto.randomUUID(), brand: '', size: '', price: '' }])}
      >
        <Plus size={16} />
        Add exception
      </Button>
    </div>
  );
}

'use client';

import { Children, isValidElement, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type WorkspaceSelectProps = Pick<
  SelectHTMLAttributes<HTMLSelectElement>,
  'id' | 'name' | 'disabled' | 'required' | 'className' | 'aria-label' | 'aria-describedby'
> & {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
};

/** Keep existing option definitions while giving every workspace picker the same accessible menu. */
export function WorkspaceSelect({
  value,
  onValueChange,
  children,
  name,
  required,
  disabled,
  ...triggerProps
}: WorkspaceSelectProps) {
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; disabled?: boolean; children: ReactNode }>(child)) return [];
    const label = Children.toArray(child.props.children)
      .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
      .join('');
    return [{ value: child.props.value ?? label, label, disabled: child.props.disabled }];
  });
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next ?? '')}
      items={options}
      name={name}
      required={required}
      disabled={disabled}
    >
      <SelectTrigger {...triggerProps}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

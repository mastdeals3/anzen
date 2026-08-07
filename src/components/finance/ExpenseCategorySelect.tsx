import { SearchableSelect } from '../SearchableSelect';
import type { ExpenseCategoryDef } from './useExpenseCategories';

/**
 * The single category control for every expense-facing module.  The options
 * come directly from the Finance Category Master hook, including its parent
 * group, so selection behaviour cannot diverge between Expenses and Petty Cash.
 */
interface ExpenseCategorySelectProps {
  value: string;
  onChange: (value: string) => void;
  categories: ExpenseCategoryDef[];
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

export function ExpenseCategorySelect({
  value,
  onChange,
  categories,
  disabled,
  required,
  className,
}: ExpenseCategorySelectProps) {
  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={categories.map((category) => ({
        value: category.value,
        label: category.label,
        group: category.group,
      }))}
      placeholder="Select category"
      disabled={disabled}
      required={required}
      className={className}
    />
  );
}

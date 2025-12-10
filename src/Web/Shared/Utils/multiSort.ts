export type SortDirection = 'asc' | 'desc';

export type SortSelector<T> = (item: T) => unknown;

export interface SortCriterion<T> {
  selector: SortSelector<T>;
  direction?: SortDirection;
  nullsFirst?: boolean;
}

export interface MultiSortOptions {
  readonly locale?: string | string[] | undefined;
  readonly collatorOptions?: Intl.CollatorOptions;
  readonly stable?: boolean;
}

export function createMultiSort<T>(
  sortCriteria: ReadonlyArray<SortCriterion<T>>,
  options?: MultiSortOptions
): (a: T, b: T) => number {
  const collator = new Intl.Collator(options?.locale, {
    numeric: true,
    sensitivity: 'base',
    ...(options?.collatorOptions ?? {}),
  });

  function compareValues(valueA: unknown, valueB: unknown, nullsFirst?: boolean): number {
    const aIsNull = valueA === null || valueA === undefined;
    const bIsNull = valueB === null || valueB === undefined;

    if (aIsNull || bIsNull) {
      if (aIsNull && bIsNull) return 0;
      const nullComesFirst = nullsFirst ?? true;
      return aIsNull ? (nullComesFirst ? -1 : 1) : nullComesFirst ? 1 : -1;
    }

    if (valueA instanceof Date && valueB instanceof Date) {
      const diff = valueA.getTime() - valueB.getTime();
      return diff < 0 ? -1 : diff > 0 ? 1 : 0;
    }

    if (typeof valueA === 'number' && typeof valueB === 'number') {
      return valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
    }

    if (typeof valueA === 'boolean' && typeof valueB === 'boolean') {
      return valueA === valueB ? 0 : valueA ? 1 : -1;
    }

    if (typeof valueA === 'string' && typeof valueB === 'string') {
      return collator.compare(valueA, valueB);
    }

    const aNum =
      typeof valueA === 'string' || typeof valueA === 'number' ? Number(valueA) : NaN;
    const bNum =
      typeof valueB === 'string' || typeof valueB === 'number' ? Number(valueB) : NaN;
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
      return aNum < bNum ? -1 : aNum > bNum ? 1 : 0;
    }

    return collator.compare(String(valueA), String(valueB));
  }

  return (a: T, b: T): number => {
    for (const criterion of sortCriteria) {
      const direction = criterion.direction ?? 'asc';
      const nullsFirst = criterion.nullsFirst;
      const valueA = criterion.selector(a);
      const valueB = criterion.selector(b);

      const cmp = compareValues(valueA, valueB, nullsFirst);
      if (cmp !== 0) {
        return direction === 'asc' ? cmp : -cmp;
      }
    }
    return 0;
  };
}

export function multiSort<T>(
  items: ReadonlyArray<T>,
  sortCriteria: ReadonlyArray<SortCriterion<T>> | ReadonlyArray<SortSelector<T>>,
  options?: MultiSortOptions
): T[] {
  const stable = options?.stable ?? true;

  const normalizedCriteria: ReadonlyArray<SortCriterion<T>> =
    sortCriteria.length === 0
      ? ([] as SortCriterion<T>[])
      : typeof sortCriteria[0] === 'function'
      ? ((sortCriteria as ReadonlyArray<SortSelector<T>>).map((selector) => ({
          selector,
        })) as ReadonlyArray<SortCriterion<T>>)
      : (sortCriteria as ReadonlyArray<SortCriterion<T>>);

  if (!stable) {
    const comparator = createMultiSort(normalizedCriteria, options);
    return Array.from(items).sort(comparator);
  }

  const comparator = createMultiSort(normalizedCriteria, options);
  const decorated = items.map((item, index) => ({ item, index }));
  decorated.sort((left, right) => {
    const primary = comparator(left.item, right.item);
    return primary !== 0 ? primary : left.index - right.index;
  });
  return decorated.map((d) => d.item);
}

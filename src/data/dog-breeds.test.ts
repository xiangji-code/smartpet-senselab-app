import { describe, expect, it } from 'vitest';

import { DOG_BREEDS, filterDogBreeds } from './dog-breeds';

describe('filterDogBreeds', () => {
  it('returns the full list for an empty search', () => {
    expect(filterDogBreeds('')).toHaveLength(DOG_BREEDS.length);
  });

  it('searches Chinese names and common aliases', () => {
    expect(filterDogBreeds('德牧')[0]?.value).toBe('德国牧羊犬');
    expect(filterDogBreeds('golden retriever')[0]?.value).toBe('金毛寻回犬');
  });

  it('returns an empty list when there is no match', () => {
    expect(filterDogBreeds('不存在的品种')).toEqual([]);
  });
});

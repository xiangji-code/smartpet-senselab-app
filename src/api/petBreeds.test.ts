import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('./client', () => ({ api: { get } }));

import { filterPetBreeds, petBreedsApi, type PetBreedOption } from './petBreeds';

const dto = {
  id: 1,
  code: 'german-shepherd',
  species: 'dog',
  name_zh: '德国牧羊犬',
  name_en: 'German Shepherd',
  aliases: ['德牧'],
  sort_order: 1,
};

describe('petBreedsApi', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue([dto]);
  });

  it('maps the backend catalog for the picker', async () => {
    await expect(petBreedsApi.list()).resolves.toMatchObject([
      { code: 'german-shepherd', value: '德国牧羊犬', nameEn: 'German Shepherd' },
    ]);
    expect(get).toHaveBeenCalledWith('/api/app/pet-breeds?species=dog');
  });

  it('rejects malformed backend data', async () => {
    get.mockResolvedValue([{ ...dto, aliases: '德牧' }]);
    await expect(petBreedsApi.list()).rejects.toThrow('品种数据格式无效');
  });
});

describe('filterPetBreeds', () => {
  const options: PetBreedOption[] = [
    {
      id: 1,
      code: dto.code,
      species: dto.species,
      value: dto.name_zh,
      nameEn: dto.name_en,
      aliases: dto.aliases,
      sortOrder: dto.sort_order,
    },
  ];

  it('searches Chinese, English, and aliases', () => {
    expect(filterPetBreeds(options, '德牧')).toHaveLength(1);
    expect(filterPetBreeds(options, 'german shepherd')).toHaveLength(1);
    expect(filterPetBreeds(options, '不存在')).toEqual([]);
  });
});

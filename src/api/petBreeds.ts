import { api } from './client';

interface PetBreedDto {
  id: number;
  code: string;
  species: string;
  name_zh: string;
  name_en: string | null;
  aliases: string[];
  sort_order: number;
}

export interface PetBreedOption {
  id: number;
  code: string;
  species: string;
  value: string;
  nameEn: string | null;
  aliases: string[];
  sortOrder: number;
}

function isPetBreedDto(value: unknown): value is PetBreedDto {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'number' &&
    typeof item.code === 'string' &&
    typeof item.species === 'string' &&
    typeof item.name_zh === 'string' &&
    (item.name_en === null || typeof item.name_en === 'string') &&
    Array.isArray(item.aliases) &&
    item.aliases.every((alias) => typeof alias === 'string') &&
    typeof item.sort_order === 'number'
  );
}

function mapBreed(dto: PetBreedDto): PetBreedOption {
  return {
    id: dto.id,
    code: dto.code,
    species: dto.species,
    value: dto.name_zh,
    nameEn: dto.name_en,
    aliases: dto.aliases,
    sortOrder: dto.sort_order,
  };
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, '');
}

export function filterPetBreeds(options: PetBreedOption[], query: string): PetBreedOption[] {
  const keyword = normalize(query.trim());
  if (!keyword) return options;
  return options.filter((breed) =>
    [breed.value, breed.nameEn ?? '', ...breed.aliases].some((candidate) =>
      normalize(candidate).includes(keyword),
    ),
  );
}

export const petBreedsApi = {
  async list(species = 'dog'): Promise<PetBreedOption[]> {
    const payload = await api.get<unknown>(
      `/api/app/pet-breeds?species=${encodeURIComponent(species)}`,
    );
    if (!Array.isArray(payload) || !payload.every(isPetBreedDto)) {
      throw new Error('品种数据格式无效');
    }
    return payload.map(mapBreed);
  },
};

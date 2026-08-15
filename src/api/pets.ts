/**
 * 宠物档案 API（对接后端 `/api/app/pets`）。
 * snake_case DTO ↔ 领域类型（camelCase）映射。
 */
import { api, ApiError } from './client';
import type { EntityStatus, PetProfile } from '../types/domain';

interface PetDto {
  id: number;
  app_user_id: number;
  name: string;
  species: string;
  breed?: string | null;
  sex?: string | null;
  birthday?: string | null;
  weight_kg?: number | null;
  avatar_url?: string | null;
  notes?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PetInput {
  name: string;
  species?: string;
  breed?: string | null;
  sex?: string | null;
  birthday?: string | null;
  weightKg?: number | null;
  avatarUrl?: string | null;
  notes?: string | null;
}

export interface PetAvatarFile {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}

function mapPet(dto: PetDto): PetProfile {
  return {
    id: dto.id,
    name: dto.name,
    species: dto.species,
    breed: dto.breed ?? null,
    sex: dto.sex ?? null,
    birthday: dto.birthday ?? null,
    weightKg: dto.weight_kg ?? null,
    avatarUrl: dto.avatar_url ?? null,
    notes: dto.notes ?? null,
    status: (dto.status === 'inactive' ? 'inactive' : 'active') as EntityStatus,
  };
}

function toBody(input: PetInput): Record<string, unknown> {
  const body: Record<string, unknown> = { name: input.name };
  if (input.species !== undefined) body.species = input.species;
  if (input.breed !== undefined) body.breed = input.breed;
  if (input.sex !== undefined) body.sex = input.sex;
  if (input.birthday !== undefined) body.birthday = input.birthday;
  if (input.weightKg !== undefined) body.weight_kg = input.weightKg;
  if (input.avatarUrl !== undefined) body.avatar_url = input.avatarUrl;
  if (input.notes !== undefined) body.notes = input.notes;
  return body;
}

const BASE = '/api/app/pets';
export const MAX_ACTIVE_PET_PROFILES = 1000;

export function createPetRequestKey(): string {
  return `pet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export const petsApi = {
  async list(includeInactive = false): Promise<PetProfile[]> {
    const dtos = await api.get<PetDto[]>(
      `${BASE}${includeInactive ? '?include_inactive=true' : ''}`,
    );
    return dtos.map(mapPet);
  },

  async get(id: number): Promise<PetProfile> {
    return mapPet(await api.get<PetDto>(`${BASE}/${id}`));
  },

  async create(input: PetInput, idempotencyKey = createPetRequestKey()): Promise<PetProfile> {
    const create = () =>
      api.post<PetDto>(BASE, toBody(input), {
        headers: { 'Idempotency-Key': idempotencyKey },
      });
    try {
      return mapPet(await create());
    } catch (error) {
      if (!(error instanceof ApiError) || !error.retryable) throw error;
      return mapPet(await create());
    }
  },

  async update(id: number, input: PetInput): Promise<PetProfile> {
    return mapPet(await api.patch<PetDto>(`${BASE}/${id}`, toBody(input)));
  },

  async uploadAvatar(id: number, file: PetAvatarFile): Promise<PetProfile> {
    const { File } = await import('expo-file-system');
    const localFile = new File(file.uri);
    if (!localFile.exists) throw new Error('待上传的宠物头像不存在');

    const form = new FormData();
    form.append('file', localFile, file.fileName || `pet-avatar-${id}.jpg`);
    return mapPet(await api.upload<PetDto>(`${BASE}/${id}/avatar`, form));
  },

  /** 停用（软删除），非物理删除 */
  async deactivate(id: number): Promise<PetProfile> {
    return mapPet(await api.delete<PetDto>(`${BASE}/${id}`));
  },
};

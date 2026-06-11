import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vaultworks_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface SubcategoryRef {
  id: string;
  name: string;
  slug: string;
  asset_count: number;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
  asset_count: number;
  subcategories: SubcategoryRef[];
}

export interface Subcategory {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
  asset_count: number;
}

export async function listCategories(): Promise<Category[]> {
  const { data } = await api.get<Category[]>('/api/categories');
  return data;
}

export async function createCategory(name: string): Promise<Category> {
  const { data } = await api.post<Category>('/api/categories', { name });
  return data;
}

export async function updateCategory(id: string, name: string): Promise<Category> {
  const { data } = await api.patch<Category>(`/api/categories/${id}`, { name });
  return data;
}

export async function deleteCategory(id: string): Promise<void> {
  await api.delete(`/api/categories/${id}`);
}

export async function createSubcategory(categoryId: string, name: string): Promise<Subcategory> {
  const { data } = await api.post<Subcategory>(`/api/categories/${categoryId}/subcategories`, { name });
  return data;
}

export async function updateSubcategory(categoryId: string, id: string, name: string): Promise<Subcategory> {
  const { data } = await api.patch<Subcategory>(`/api/categories/${categoryId}/subcategories/${id}`, { name });
  return data;
}

export async function deleteSubcategory(categoryId: string, id: string): Promise<void> {
  await api.delete(`/api/categories/${categoryId}/subcategories/${id}`);
}

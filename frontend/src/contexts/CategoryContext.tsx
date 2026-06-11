import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { listCategories, type Category } from '../api/categories.js';

interface CategoryState {
  categories: Category[];
  selectedCategoryId: string | null;
  selectedSubcategoryId: string | null;
  searchQuery: string;
  setSelectedCategoryId: (id: string | null) => void;
  setSelectedSubcategoryId: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
}

const CategoryContext = createContext<CategoryState>({
  categories: [],
  selectedCategoryId: null,
  selectedSubcategoryId: null,
  searchQuery: '',
  setSelectedCategoryId: () => {},
  setSelectedSubcategoryId: () => {},
  setSearchQuery: () => {},
});

export function CategoryProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryIdRaw] = useState<string | null>(null);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
  }, []);

  function setSelectedCategoryId(id: string | null) {
    setSelectedCategoryIdRaw(id);
    setSelectedSubcategoryId(null);
  }

  return (
    <CategoryContext.Provider value={{
      categories,
      selectedCategoryId,
      selectedSubcategoryId,
      searchQuery,
      setSelectedCategoryId,
      setSelectedSubcategoryId,
      setSearchQuery,
    }}>
      {children}
    </CategoryContext.Provider>
  );
}

export function useCategoryContext() {
  return useContext(CategoryContext);
}

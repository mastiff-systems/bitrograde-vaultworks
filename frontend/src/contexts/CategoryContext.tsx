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
    // Don't swallow failures silently — an empty Taxonomy with no console trace
    // made the MAS-621 mustChangePassword lockout invisible to diagnose
    listCategories().then(setCategories).catch((err) => {
      console.error('Failed to load categories', err);
    });
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

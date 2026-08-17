import { useCallback, useEffect, useReducer, useState } from 'react';
import type { Asset } from '../../api/client.js';
import { uploadWithMetadata } from '../../api/client.js';
import { listCategories, type Category } from '../../api/categories.js';

export interface WizardState {
  step: 'file' | 'metadata' | 'review' | 'submitting' | 'done' | 'error';
  file: File | null;
  customName: string;
  detectedType: string | null;
  detectedDimensions: { w: number; h: number } | null;
  detectedDuration: number | null;
  metadata: {
    categoryId: string | null;
    subcategoryId: string | null;
    license: string | null;
    description: string;
    tags: string[];
  };
  uploadedAsset: Asset | null;
  uploadProgress: number;
  error: string | null;
}

export type WizardAction =
  | { type: 'SELECT_FILE'; file: File; detectedType: string | null; detectedDimensions: { w: number; h: number } | null; detectedDuration: number | null }
  | { type: 'REMOVE_FILE' }
  | { type: 'GO_NEXT' }
  | { type: 'GO_BACK' }
  | { type: 'SET_CATEGORY'; categoryId: string | null }
  | { type: 'SET_METADATA'; patch: Partial<WizardState['metadata']> }
  | { type: 'SET_CUSTOM_NAME'; name: string }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_PROGRESS'; pct: number }
  | { type: 'SUBMIT_SUCCESS'; asset: Asset }
  | { type: 'SUBMIT_ERROR'; message: string }
  | { type: 'RETRY' }
  | { type: 'RESET' };

const initialMetadata = {
  categoryId: null,
  subcategoryId: null,
  license: null,
  description: '',
  tags: [],
};

const initialState: WizardState = {
  step: 'file',
  file: null,
  customName: '',
  detectedType: null,
  detectedDimensions: null,
  detectedDuration: null,
  metadata: initialMetadata,
  uploadedAsset: null,
  uploadProgress: 0,
  error: null,
};

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SELECT_FILE':
      return {
        ...state,
        file: action.file,
        customName: action.file.name,
        detectedType: action.detectedType,
        detectedDimensions: action.detectedDimensions,
        detectedDuration: action.detectedDuration,
      };
    case 'REMOVE_FILE':
      return { ...state, file: null, customName: '', detectedType: null, detectedDimensions: null, detectedDuration: null };
    case 'SET_CUSTOM_NAME':
      return { ...state, customName: action.name };
    case 'GO_NEXT': {
      if (state.step === 'file' && state.file) return { ...state, step: 'metadata' };
      if (state.step === 'metadata') return { ...state, step: 'review' };
      return state;
    }
    case 'GO_BACK': {
      if (state.step === 'metadata') return { ...state, step: 'file' };
      if (state.step === 'review') return { ...state, step: 'metadata' };
      if (state.step === 'error') return { ...state, step: 'review', error: null };
      return state;
    }
    case 'SET_CATEGORY':
      return { ...state, metadata: { ...state.metadata, categoryId: action.categoryId, subcategoryId: null } };
    case 'SET_METADATA':
      return { ...state, metadata: { ...state.metadata, ...action.patch } };
    case 'SUBMIT_START':
      return { ...state, step: 'submitting', uploadProgress: 0, error: null };
    case 'SUBMIT_PROGRESS':
      return { ...state, uploadProgress: action.pct };
    case 'SUBMIT_SUCCESS':
      return { ...state, step: 'done', uploadedAsset: action.asset, uploadProgress: 100 };
    case 'SUBMIT_ERROR':
      return { ...state, step: 'error', error: action.message };
    case 'RETRY':
      return { ...state, step: 'submitting', uploadProgress: 0, error: null };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

async function detectFileMeta(file: File): Promise<{ detectedType: string | null; detectedDimensions: { w: number; h: number } | null; detectedDuration: number | null }> {
  const mime = file.type;

  if (mime.startsWith('image/')) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ detectedType: 'image', detectedDimensions: { w: img.naturalWidth, h: img.naturalHeight }, detectedDuration: null });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ detectedType: 'image', detectedDimensions: null, detectedDuration: null });
      };
      img.src = url;
    });
  }

  if (mime.startsWith('video/')) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve({ detectedType: 'video', detectedDimensions: { w: video.videoWidth, h: video.videoHeight }, detectedDuration: video.duration || null });
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ detectedType: 'video', detectedDimensions: null, detectedDuration: null });
      };
      video.src = url;
    });
  }

  if (mime.startsWith('audio/')) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const audio = document.createElement('audio');
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve({ detectedType: 'audio', detectedDimensions: null, detectedDuration: audio.duration || null });
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ detectedType: 'audio', detectedDimensions: null, detectedDuration: null });
      };
      audio.src = url;
    });
  }

  if (mime.startsWith('model/') || /\.(glb|gltf|obj|fbx)$/i.test(file.name)) {
    return { detectedType: '3d', detectedDimensions: null, detectedDuration: null };
  }

  return { detectedType: null, detectedDimensions: null, detectedDuration: null };
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const res = (err as { response?: { status?: number; data?: { error?: string } } }).response;
    if (res?.status === 409) return 'A file with this name already exists.';
    if (res?.status === 400 && res?.data?.error) return res.data.error;
    if (res?.status && res.status >= 500) return 'Server error. Please try again.';
  }
  return 'Upload failed. Please try again.';
}

export interface UseUploadWizard {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  categories: Category[];
  categoriesLoading: boolean;
  categoriesError: string | null;
  selectFile: (file: File) => Promise<void>;
  submit: () => Promise<void>;
}

export function useUploadWizard(onComplete: (asset: Asset) => void): UseUploadWizard {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  useEffect(() => {
    setCategoriesLoading(true);
    listCategories()
      .then(setCategories)
      .catch(() => setCategoriesError('Could not load categories'))
      .finally(() => setCategoriesLoading(false));
  }, []);

  const selectFile = useCallback(async (file: File) => {
    const meta = await detectFileMeta(file);
    dispatch({ type: 'SELECT_FILE', file, ...meta });
  }, []);

  const submit = useCallback(async () => {
    if (!state.file) return;
    dispatch({ type: 'SUBMIT_START' });
    try {
      const asset = await uploadWithMetadata(
        state.file,
        {
          customName: state.customName || state.file.name,
          categoryId: state.metadata.categoryId,
          subcategoryId: state.metadata.subcategoryId,
          license: state.metadata.license,
          description: state.metadata.description || undefined,
          tags: state.metadata.tags.length > 0 ? state.metadata.tags : undefined,
          resolutionW: state.detectedDimensions?.w,
          resolutionH: state.detectedDimensions?.h,
          durationSeconds: state.detectedDuration ?? undefined,
        },
        (pct) => dispatch({ type: 'SUBMIT_PROGRESS', pct }),
      );
      dispatch({ type: 'SUBMIT_SUCCESS', asset });
      onComplete(asset);
    } catch (err) {
      dispatch({ type: 'SUBMIT_ERROR', message: extractErrorMessage(err) });
    }
  }, [state, onComplete]);

  return { state, dispatch, categories, categoriesLoading, categoriesError, selectFile, submit };
}

import { createContext, useContext, useState, type ReactNode } from 'react';

interface UploadCtx {
  showWizard: boolean;
  uploading: boolean;
  progress: number;
  openWizard: () => void;
  closeWizard: () => void;
  setUploading: (v: boolean) => void;
  setProgress: (p: number) => void;
}

const UploadContext = createContext<UploadCtx>({
  showWizard: false,
  uploading: false,
  progress: 0,
  openWizard: () => {},
  closeWizard: () => {},
  setUploading: () => {},
  setProgress: () => {},
});

export function UploadProvider({ children }: { children: ReactNode }) {
  const [showWizard, setShowWizard] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  return (
    <UploadContext.Provider value={{
      showWizard,
      uploading,
      progress,
      openWizard: () => setShowWizard(true),
      closeWizard: () => setShowWizard(false),
      setUploading,
      setProgress,
    }}>
      {children}
    </UploadContext.Provider>
  );
}

export const useUpload = () => useContext(UploadContext);

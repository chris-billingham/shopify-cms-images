import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZES, getAssetType } from '../types';
import { apiClient } from '../api/client';

interface FileState {
  file: File;
  status: 'pending' | 'checking' | 'duplicate' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
  duplicateAsset?: { id: string; file_name: string };
}

interface DuplicateCheckResponse {
  isDuplicate: boolean;
  existingAsset?: { id: string; file_name: string };
}

function validateFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return `File type "${file.type}" is not supported.`;
  }
  const assetType = getAssetType(file.type);
  if (assetType) {
    const maxSize = MAX_FILE_SIZES[assetType];
    if (file.size > maxSize) {
      const mb = maxSize / (1024 * 1024);
      return `File exceeds the ${mb} MB size limit for ${assetType} files.`;
    }
  }
  return null;
}

export function UploadView() {
  const [files, setFiles] = useState<FileState[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const checkDuplicate = useMutation({
    mutationFn: async (file: File) => {
      const { data } = await apiClient.post<DuplicateCheckResponse>(
        '/assets/check-duplicate',
        { file_name: file.name, file_size: file.size },
      );
      return data;
    },
  });

  const processFiles = async (incomingFiles: File[]) => {
    const newStates: FileState[] = incomingFiles.map((file) => {
      const validationError = validateFile(file);
      return {
        file,
        status: validationError ? 'error' : 'pending',
        progress: 0,
        error: validationError ?? undefined,
      };
    });

    setFiles((prev) => [...prev, ...newStates]);

    // Run duplicate checks for valid files
    for (const state of newStates) {
      if (state.status === 'error') continue;

      setFiles((prev) =>
        prev.map((f) =>
          f.file === state.file ? { ...f, status: 'checking' } : f,
        ),
      );

      try {
        const result = await checkDuplicate.mutateAsync(state.file);
        if (result.isDuplicate) {
          setFiles((prev) =>
            prev.map((f) =>
              f.file === state.file
                ? { ...f, status: 'duplicate', duplicateAsset: result.existingAsset }
                : f,
            ),
          );
        } else {
          setFiles((prev) =>
            prev.map((f) =>
              f.file === state.file ? { ...f, status: 'uploading' } : f,
            ),
          );
          await uploadFile(state.file);
        }
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.file === state.file ? { ...f, status: 'error', error: 'Upload failed' } : f,
          ),
        );
      }
    }
  };

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      await apiClient.post('/assets', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
          setFiles((prev) =>
            prev.map((f) =>
              f.file === file ? { ...f, progress: pct } : f,
            ),
          );
        },
      });
      setFiles((prev) =>
        prev.map((f) => (f.file === file ? { ...f, status: 'done', progress: 100 } : f)),
      );
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    } catch {
      setFiles((prev) =>
        prev.map((f) =>
          f.file === file ? { ...f, status: 'error', error: 'Upload failed' } : f,
        ),
      );
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) {
      processFiles(dropped);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length > 0) {
      processFiles(selected);
    }
  };

  const handleDismissDuplicate = (file: File) => {
    setFiles((prev) => prev.filter((f) => f.file !== file));
  };

  const handleProceedDuplicate = async (file: File) => {
    setFiles((prev) =>
      prev.map((f) => (f.file === file ? { ...f, status: 'uploading' } : f)),
    );
    await uploadFile(file);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-4">Upload Assets</h2>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="region"
        aria-label="Drop zone"
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <p className="text-gray-500">Drag &amp; drop files here, or click to select</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <ul className="mt-4 space-y-3">
          {files.map((fileState, idx) => (
            <li key={idx} className="border rounded p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate">{fileState.file.name}</span>
                <span
                  className={`text-xs ml-2 ${
                    fileState.status === 'error' ? 'text-red-500' :
                    fileState.status === 'done' ? 'text-green-500' :
                    'text-gray-500'
                  }`}
                >
                  {fileState.status}
                </span>
              </div>

              {fileState.error && (
                <p role="alert" className="mt-1 text-xs text-red-500">
                  {fileState.error}
                </p>
              )}

              {fileState.status === 'uploading' && (
                <div className="mt-2">
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${fileState.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Duplicate modal */}
              {fileState.status === 'duplicate' && fileState.duplicateAsset && (
                <div role="dialog" aria-label="Duplicate detected" className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
                  <p className="text-yellow-800">
                    A duplicate already exists: <strong>{fileState.duplicateAsset.file_name}</strong>
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => handleDismissDuplicate(fileState.file)}
                      className="px-2 py-1 bg-gray-100 rounded text-xs"
                    >
                      Skip
                    </button>
                    <button
                      onClick={() => handleProceedDuplicate(fileState.file)}
                      className="px-2 py-1 bg-blue-600 text-white rounded text-xs"
                    >
                      Replace
                    </button>
                    <button
                      onClick={() => handleProceedDuplicate(fileState.file)}
                      className="px-2 py-1 bg-gray-600 text-white rounded text-xs"
                    >
                      Upload Anyway
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
